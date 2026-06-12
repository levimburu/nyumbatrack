import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProperty } from "@/context/PropertyContext";
import { formatKES } from "@/lib/format";
import { Plus, X, Mail, Phone, Calendar, Building2, DoorOpen, DoorClosed, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/units")({
  component: UnitsPage,
});

interface Tenant {
  id: string;
  full_name: string;
  unit: string;
  rent_amount: number;
  email: string | null;
  phone: string | null;
  move_in_date: string | null;
  next_due_date: string | null;
}

interface UnitRow {
  id: string;
  unit_name: string;
  rent_price: number;
}

function UnitsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { selectedProperty } = useProperty();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);

  useEffect(() => {
    if (!selectedProperty) navigate({ to: "/properties" });
  }, [selectedProperty, navigate]);

  const { data: tenants } = useQuery({
    queryKey: ["tenants-units", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, full_name, unit, rent_amount, email, phone, move_in_date, next_due_date")
        .eq("property_id", selectedProperty!.id)
        .order("unit");
      if (error) throw error;
      return data as Tenant[];
    },
  });

  const { data: units } = useQuery({
    queryKey: ["units", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("units")
        .select("id, unit_name, rent_price")
        .eq("property_id", selectedProperty!.id)
        .order("unit_name");
      if (error) throw error;
      return data as UnitRow[];
    },
  });

  const addUnit = useMutation({
    mutationFn: async (u: { unit_name: string; rent_price: number }) => {
      const { error } = await (supabase as any).from("units").insert({
        property_id: selectedProperty!.id,
        unit_name: u.unit_name,
        rent_price: u.rent_price,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["units", selectedProperty?.id] });
      setAdding(false);
      toast.success("Unit added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editUnit = useMutation({
    mutationFn: async (u: { id: string; unit_name: string; rent_price: number }) => {
      const { error } = await (supabase as any).from("units").update({
        unit_name: u.unit_name,
        rent_price: u.rent_price,
      }).eq("id", u.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["units", selectedProperty?.id] });
      setEditing(null);
      toast.success("Unit updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!selectedProperty) return null;

  const occupiedUnitNames = new Set((tenants ?? []).map((t) => t.unit));

  // Vacant units = units in `units` table whose unit_name has no matching tenant
  const vacantUnits = (units ?? []).filter((u) => !occupiedUnitNames.has(u.unit_name));

  const totalUnitsCount = (tenants?.length ?? 0) + vacantUnits.length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Units</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedProperty.name} · {totalUnitsCount} {totalUnitsCount === 1 ? "unit" : "units"} · {tenants?.length ?? 0} occupied · {vacantUnits.length} vacant
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white glow-primary"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Add Vacant Unit
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Occupied units — from tenants */}
        {tenants?.map((t) => {
          const initials = t.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
          const today = new Date().toISOString().slice(0, 10);
          const isPaid = t.next_due_date && t.next_due_date > today;
          return (
            <div key={t.id} className="card-surface overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#F0FDF4" }}>
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#DCFCE7" }}>
                    <DoorOpen className="h-4 w-4" style={{ color: "#16A34A" }} />
                  </div>
                  <div>
                    <div className="font-display font-bold text-sm text-foreground">Unit {t.unit}</div>
                    <div className="text-xs" style={{ color: "#16A34A" }}>Occupied</div>
                  </div>
                </div>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: isPaid ? "#DCFCE7" : "#FEE2E2", color: isPaid ? "#166534" : "#991B1B" }}>
                  {isPaid ? "Paid" : "Unpaid"}
                </span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0" style={{ background: "#166534" }}>
                    {initials}
                  </div>
                  <span className="font-semibold text-sm">{t.full_name}</span>
                </div>
                <div className="text-sm font-display font-bold text-foreground">{formatKES(t.rent_amount)}<span className="text-xs text-muted-foreground font-normal">/month</span></div>
                {t.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" /> {t.phone}
                  </div>
                )}
                {t.email && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" /> {t.email}
                  </div>
                )}
                {t.move_in_date && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" /> Moved in {new Date(t.move_in_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Vacant units */}
        {vacantUnits.map((u) => (
          <div key={u.id} className="card-surface overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#FFF7ED" }}>
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#FEE2E2" }}>
                  <DoorClosed className="h-4 w-4" style={{ color: "#DC2626" }} />
                </div>
                <div>
                  <div className="font-display font-bold text-sm text-foreground">Unit {u.unit_name}</div>
                  <div className="text-xs" style={{ color: "#DC2626" }}>Vacant</div>
                </div>
              </div>
              <button
                onClick={() => setEditing(u)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            </div>
            <div className="p-4">
              <div className="text-sm font-display font-bold text-foreground">{formatKES(u.rent_price)}<span className="text-xs text-muted-foreground font-normal">/month</span></div>
              <p className="text-xs text-muted-foreground mt-2">Available for a new tenant.</p>
            </div>
          </div>
        ))}

        {!tenants?.length && !vacantUnits.length && (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3 flex flex-col items-center">
            <Building2 className="h-10 w-10 mb-3 text-muted-foreground" />
            No units yet. Add tenants or vacant units to get started.
          </div>
        )}
      </div>

      {adding && (
        <UnitForm
          onSave={(u) => addUnit.mutate(u)}
          onClose={() => setAdding(false)}
          saving={addUnit.isPending}
        />
      )}
      {editing && (
        <UnitForm
          initial={editing}
          onSave={(u) => editUnit.mutate({ id: editing.id, ...u })}
          onClose={() => setEditing(null)}
          saving={editUnit.isPending}
        />
      )}
    </div>
  );
}

function UnitForm({
  initial, onSave, onClose, saving,
}: {
  initial?: UnitRow;
  onSave: (u: { unit_name: string; rent_price: number }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [unitName, setUnitName] = useState(initial?.unit_name ?? "");
  const [rentPrice, setRentPrice] = useState<number>(initial?.rent_price ?? 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-md p-6 animate-slide-up">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? "Edit Unit" : "Add Vacant Unit"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ unit_name: unitName, rent_price: rentPrice }); }} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Unit Name *</label>
            <input required value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. B3" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Monthly Rent (KSh) *</label>
            <input required type="number" min={0} value={rentPrice} onChange={(e) => setRentPrice(Number(e.target.value))} className="form-input" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 glow-primary" style={{ background: "#166534" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>
  );
}