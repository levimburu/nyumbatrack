import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Plus, Pencil, Trash2, X, Calendar } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "./dashboard";
import { useProperty } from "@/context/PropertyContext";

export const Route = createFileRoute("/_authenticated/tenants")({
  component: TenantsPage,
});

interface Tenant {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  unit: string;
  rent_amount: number;
  deposit: number | null;
  due_day: number;
  balance: number;
  status: string;
  next_due_date: string | null;
  property_id: string | null;
  move_in_date: string | null;
  advance_months: number | null;
}

interface Payment {
  id: string;
  amount: number;
  paid_on: string;
  method: string;
  payment_month: string | null;
  reference: string | null;
}

function TenantsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { selectedProperty } = useProperty();
  const [editing, setEditing] = useState<Partial<Tenant> | null>(null);
  const [viewingHistory, setViewingHistory] = useState<Tenant | null>(null);

  useEffect(() => {
    if (!selectedProperty) navigate({ to: "/properties" });
  }, [selectedProperty, navigate]);

  const { data } = useQuery({
    queryKey: ["tenants", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("property_id", selectedProperty!.id)
        .order("unit");
      if (error) throw error;
      return data as any as Tenant[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (t: Partial<Tenant>) => {
      if (t.id) {
        const { error } = await supabase.from("tenants").update({
          full_name: t.full_name,
          email: t.email,
          phone: t.phone,
          unit: t.unit,
          rent_amount: t.rent_amount,
          deposit: t.deposit ?? null,
          due_day: t.due_day,
          move_in_date: t.move_in_date ?? null,
          advance_months: t.advance_months ?? 0,
        } as any).eq("id", t.id);
        if (error) throw error;
      } else {
        // Calculate next due date from move-in date and advance months
        let nextDueDate = null;
        if (t.move_in_date) {
          const moveIn = new Date(t.move_in_date);
          const advanceMonths = t.advance_months ?? 0;
          const nextDue = new Date(
            moveIn.getFullYear(),
            moveIn.getMonth() + advanceMonths + 1,
            t.due_day ?? 1
          );
          nextDueDate = nextDue.toISOString().slice(0, 10);
        }

        const { error } = await supabase.from("tenants").insert({
          full_name: t.full_name!,
          email: t.email,
          phone: t.phone,
          unit: t.unit!,
          rent_amount: t.rent_amount ?? 0,
          deposit: t.deposit ?? null,
          due_day: t.due_day ?? 1,
          balance: t.rent_amount ?? 0,
          property_id: selectedProperty!.id,
          move_in_date: t.move_in_date ?? null,
          advance_months: t.advance_months ?? 0,
          next_due_date: nextDueDate,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants", selectedProperty?.id] });
      setEditing(null);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants", selectedProperty?.id] });
      toast.success("Tenant removed");
    },
  });

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {selectedProperty.name}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Tenants</h1>
        </div>
        <button
          onClick={() => setEditing({})}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-glow"
        >
          <Plus className="h-4 w-4" /> Add tenant
        </button>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Name</th>
              <th>Unit</th>
              <th>Phone</th>
              <th>Rent</th>
              <th>Balance</th>
              <th>Next Due</th>
              <th>Status</th>
              <th className="text-right pr-5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((t) => {
              const status = Number(t.balance) === 0 ? "paid" : Number(t.balance) < Number(t.rent_amount) ? "partial" : "unpaid";
              const isOverdue = t.next_due_date && new Date(t.next_due_date) < new Date() && status !== "paid";
              return (
                <tr key={t.id} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-medium">{t.full_name}</div>
                    <div className="text-xs text-muted-foreground">{t.email}</div>
                  </td>
                  <td>{t.unit}</td>
                  <td className="text-muted-foreground">{t.phone}</td>
                  <td>{formatKES(t.rent_amount)}</td>
                  <td className="font-medium">{formatKES(t.balance)}</td>
                  <td>
                    {t.next_due_date ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${isOverdue ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
                        <Calendar className="h-3 w-3" />
                        {formatDate(t.next_due_date)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td><StatusPill status={status as "paid" | "partial" | "unpaid"} /></td>
                  <td className="pr-5 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => setViewingHistory(t)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Payment history"
                      >
                        <Calendar className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditing(t)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Remove ${t.full_name}?`)) del.mutate(t.id); }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!data?.length && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No tenants yet for {selectedProperty.name}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <TenantForm
          initial={editing}
          onSave={(t) => upsert.mutate(t)}
          onClose={() => setEditing(null)}
          saving={upsert.isPending}
        />
      )}
      {viewingHistory && (
        <PaymentHistory
          tenant={viewingHistory}
          onClose={() => setViewingHistory(null)}
        />
      )}
    </div>
  );
}

function PaymentHistory({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { data: payments, isLoading } = useQuery({
    queryKey: ["tenant-payments", tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("paid_on", { ascending: false });
      if (error) throw error;
      return data as any as Payment[];
    },
  });

  const nextDue = tenant.next_due_date ? new Date(tenant.next_due_date) : null;
  const isOverdue = nextDue && nextDue < new Date();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">{tenant.full_name}</h2>
            <p className="text-sm text-muted-foreground">Unit {tenant.unit} · Payment History</p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>

        {/* Tenant details */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          {tenant.move_in_date && (
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground mb-1">Move-in date</div>
              <div className="font-medium text-sm">{formatDate(tenant.move_in_date)}</div>
            </div>
          )}
          {tenant.deposit != null && Number(tenant.deposit) > 0 && (
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground mb-1">Deposit paid</div>
              <div className="font-medium text-sm">{formatKES(tenant.deposit)}</div>
            </div>
          )}
          {tenant.advance_months != null && Number(tenant.advance_months) > 0 && (
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground mb-1">Advance months</div>
              <div className="font-medium text-sm">{tenant.advance_months} months</div>
            </div>
          )}
          <div className="rounded-xl bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground mb-1">Monthly rent</div>
            <div className="font-medium text-sm">{formatKES(tenant.rent_amount)}</div>
          </div>
        </div>

        {/* Next due date */}
        <div className={`mb-4 rounded-xl p-4 ${isOverdue ? "bg-destructive/10 border border-destructive/20" : "bg-success/10 border border-success/20"}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Next Due Date</div>
          <div className={`font-display text-lg font-semibold ${isOverdue ? "text-destructive" : "text-success"}`}>
            {nextDue ? nextDue.toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "Not set yet"}
          </div>
          {isOverdue && <div className="text-xs text-destructive mt-1">⚠️ Overdue</div>}
        </div>

        {/* Payment history */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Payment History</div>
          {isLoading && <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>}
          {payments?.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">No payments recorded yet.</div>}
          {payments?.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {p.payment_month ?? formatDate(p.paid_on)}
                  </span>
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium uppercase">{p.method}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Paid on {formatDate(p.paid_on)}
                  {p.reference && ` · ${p.reference}`}
                </div>
              </div>
              <div className="font-display font-semibold text-success">+{formatKES(p.amount)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TenantForm({ initial, onSave, onClose, saving }: {
  initial: Partial<Tenant>;
  onSave: (t: Partial<Tenant>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<Tenant>>(initial);
  const set = <K extends keyof Tenant>(k: K, v: Tenant[K]) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial.id ? "Edit tenant" : "Add tenant"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Full name" className="sm:col-span-2">
            <input required value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} className="form-input" />
          </FormField>
          <FormField label="Email">
            <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} className="form-input" />
          </FormField>
          <FormField label="Phone">
            <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="form-input" placeholder="+254…" />
          </FormField>
          <FormField label="Unit">
            <input required value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value)} className="form-input" />
          </FormField>
          <FormField label="Due day (1-28)">
            <input type="number" min={1} max={28} value={form.due_day ?? 1} onChange={(e) => set("due_day", Number(e.target.value))} className="form-input" />
          </FormField>
          <FormField label="Monthly rent (KES)">
            <input type="number" min={0} value={form.rent_amount ?? 0} onChange={(e) => set("rent_amount", Number(e.target.value))} className="form-input" />
          </FormField>
          <FormField label="Deposit (KES) — optional">
            <input type="number" min={0} value={form.deposit ?? ""} onChange={(e) => set("deposit", e.target.value ? Number(e.target.value) : null as any)} className="form-input" placeholder="Leave blank if none" />
          </FormField>
          <FormField label="Move-in date">
            <input type="date" value={form.move_in_date ?? ""} onChange={(e) => set("move_in_date", e.target.value)} className="form-input" />
          </FormField>
          <FormField label="Advance months paid">
            <input type="number" min={0} max={24} value={form.advance_months ?? 0} onChange={(e) => set("advance_months", Number(e.target.value))} className="form-input" placeholder="e.g. 3" />
          </FormField>
          <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="glow-primary rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-glow disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.5rem;border:1px solid var(--color-border);background:var(--color-card);padding:.5rem .75rem;font-size:.875rem;outline:none}.form-input:focus{border-color:var(--color-ring);box-shadow:0 0 0 3px rgba(37,99,235,0.12)}`}</style>
      </div>
    </div>
  );
}

function FormField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}