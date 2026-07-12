import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Plus, Pencil, Trash2, X, Eye, Search, Key, Copy } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "./dashboard";
import { useProperty } from "@/context/PropertyContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ReminderButton, usePropertyPaymentDetails } from "@/components/ReminderButton";
import { isOverdue, outstandingForDueMonth } from "@/lib/reminders";

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

/** Shape of the property-wide payments query, mirroring payments.tsx. */
interface PropertyPaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  payment_month: string | null;
  tenants: { property_id: string } | null;
}

function TenantsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { selectedProperty } = useProperty();
  const [editing, setEditing] = useState<Partial<Tenant> | null>(null);
  const [viewingHistory, setViewingHistory] = useState<Tenant | null>(null);
  const [search, setSearch] = useState("");
  const [tenantCode, setTenantCode] = useState<{ code: string; name: string } | null>(null);
  const [isAgent, setIsAgent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.role === "agent") setIsAgent(true);
    });
  }, []);

  useEffect(() => {
    if (!selectedProperty) navigate({ to: "/properties" });
  }, [selectedProperty, navigate]);

  const { data: propertyPayment } = usePropertyPaymentDetails(selectedProperty?.id);

  const generateTenantCode = async (tenantId: string, tenantName: string) => {
    const code = "TNT-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await (supabase as any).from("tenant_invite_codes").insert({
      tenant_id: tenantId,
      code,
    });
    if (error) { toast.error("Failed to generate code"); return; }
    setTenantCode({ code, name: tenantName });
  };

  const { data: vacantUnits } = useQuery({
    queryKey: ["vacant-units", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data: units, error: unitsError } = await (supabase as any)
        .from("units")
        .select("id, unit_name, rent_price")
        .eq("property_id", selectedProperty!.id)
        .order("unit_name");
      if (unitsError) throw unitsError;
      const { data: tenantsData, error: tenantsError } = await (supabase as any)
        .from("tenants")
        .select("unit")
        .eq("property_id", selectedProperty!.id);
      if (tenantsError) throw tenantsError;
      const occupied = new Set((tenantsData ?? []).map((t: any) => t.unit));
      return (units ?? []).filter((u: any) => !occupied.has(u.unit_name));
    },
  });

  const { data } = useQuery({
    queryKey: ["tenants", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("*")
        .eq("property_id", selectedProperty!.id)
        .order("unit");
      if (error) throw error;
      return data as Tenant[];
    },
  });

  // Same query key and shape as payments.tsx, so both pages share one cache
  // entry and the existing invalidations below keep this page fresh.
  const { data: allPayments } = useQuery({
    queryKey: ["payments", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("*, tenants(full_name, unit, property_id)")
        .order("paid_on", { ascending: false });
      if (error) throw error;
      const all = data as PropertyPaymentRow[];
      return all.filter((p) => p.tenants?.property_id === selectedProperty!.id);
    },
  });

  const paymentsByTenant: Record<string, PropertyPaymentRow[]> = {};
  (allPayments ?? []).forEach((p) => {
    (paymentsByTenant[p.tenant_id] ??= []).push(p);
  });

  const filtered = data?.filter((t) =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.unit.toLowerCase().includes(search.toLowerCase())
  );

  const upsert = useMutation({
    mutationFn: async (t: Partial<Tenant> & { paid_months?: string[] }) => {
      const MONTHS_FULL = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const dueDay = t.due_day ?? 1;

      // Given a set of "Month Year" labels, compute the latest one and return
      // the next due date as the month after it (at the tenant's due day).
      const nextDueFromMonths = (months: string[]): string | null => {
        if (!months.length) return null;
        let latest = -Infinity;
        let latestDate: Date | null = null;
        for (const m of months) {
          const d = new Date(m);
          if (!isNaN(d.getTime())) {
            const ym = d.getFullYear() * 12 + d.getMonth();
            if (ym > latest) { latest = ym; latestDate = d; }
          }
        }
        if (!latestDate) return null;
        const nd = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, dueDay);
        return nd.toISOString().slice(0, 10);
      };

      if (t.id) {
        // --- EDIT existing tenant ---
        const { error } = await supabase.from("tenants").update({
          full_name: t.full_name,
          email: t.email,
          phone: t.phone,
          unit: t.unit,
          rent_amount: t.rent_amount,
          deposit: t.deposit ?? null,
          due_day: dueDay,
          move_in_date: t.move_in_date ?? null,
          advance_months: t.advance_months ?? 0,
        } as any).eq("id", t.id);
        if (error) throw error;

        // If the landlord marked paid months, back-fill records for any that
        // don't already have a payment (skip months already recorded, so we
        // never double up on real payments).
        const selectedMonths = t.paid_months ?? [];
        if (selectedMonths.length > 0 && (t.rent_amount ?? 0) > 0) {
          const { data: existingPays } = await (supabase as any)
            .from("payments")
            .select("payment_month")
            .eq("tenant_id", t.id);
          const already = new Set((existingPays ?? []).map((p: any) => p.payment_month));
          const paidOn = new Date().toISOString().slice(0, 10);
          const toInsert = selectedMonths
            .filter((m) => !already.has(m))
            .map((m) => ({
              tenant_id: t.id,
              amount: t.rent_amount ?? 0,
              paid_on: paidOn,
              method: "advance",
              payment_month: m,
              reference: "Recorded on enrollment",
            }));
          if (toInsert.length > 0) {
            const { error: payError } = await (supabase as any).from("payments").insert(toInsert);
            if (payError) throw payError;
          }
          // Advance next_due_date if the marked months push it forward.
          const nd = nextDueFromMonths(selectedMonths);
          if (nd) {
            await (supabase as any).from("tenants").update({ next_due_date: nd }).eq("id", t.id);
          }
        }
      } else {
        // --- ADD new tenant ---
        const advanceMonths = t.advance_months ?? 0;
        const startBase = t.move_in_date
          ? new Date(t.move_in_date + "T00:00:00")
          : new Date();

        // Months to mark Paid, and the resulting next due date.
        const monthsToFill: string[] = [];
        let nextDueDate: string | null = null;

        const selectedMonths = t.paid_months ?? [];
        if (selectedMonths.length > 0) {
          // Existing-tenant mode: explicit list of paid months.
          monthsToFill.push(...selectedMonths);
          nextDueDate = nextDueFromMonths(selectedMonths);
        } else if (advanceMonths > 0) {
          // New-tenant mode: advance months forward from the start month.
          for (let i = 0; i < advanceMonths; i++) {
            const d = new Date(startBase.getFullYear(), startBase.getMonth() + i, 1);
            monthsToFill.push(`${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`);
          }
          if (t.move_in_date) {
            const nd = new Date(startBase.getFullYear(), startBase.getMonth() + advanceMonths + 1, dueDay);
            nextDueDate = nd.toISOString().slice(0, 10);
          }
        } else if (t.move_in_date) {
          const nd = new Date(startBase.getFullYear(), startBase.getMonth() + 1, dueDay);
          nextDueDate = nd.toISOString().slice(0, 10);
        }

        const { data: inserted, error } = await (supabase as any)
          .from("tenants")
          .insert({
            full_name: t.full_name!,
            email: t.email,
            phone: t.phone,
            unit: t.unit!,
            rent_amount: t.rent_amount ?? 0,
            deposit: t.deposit ?? null,
            due_day: dueDay,
            balance: t.rent_amount ?? 0,
            property_id: selectedProperty!.id,
            move_in_date: t.move_in_date ?? null,
            advance_months: advanceMonths,
            next_due_date: nextDueDate,
          })
          .select("id")
          .single();
        if (error) throw error;

        if (inserted?.id && monthsToFill.length > 0 && (t.rent_amount ?? 0) > 0) {
          const paidOn = new Date().toISOString().slice(0, 10);
          const records = monthsToFill.map((m) => ({
            tenant_id: inserted.id,
            amount: t.rent_amount ?? 0,
            paid_on: paidOn,
            method: "advance",
            payment_month: m,
            reference: "Recorded on enrollment",
          }));
          const { error: payError } = await (supabase as any).from("payments").insert(records);
          if (payError) throw payError;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenants", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["tenants-min", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["payments", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["payments-this-month", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["all-payments-current-month"] });
      qc.invalidateQueries({ queryKey: ["all-tenants-for-stats"] });
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
      qc.invalidateQueries({ queryKey: ["payments", selectedProperty?.id] });
      toast.success("Tenant removed");
    },
  });

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedProperty.name} · {data?.length ?? 0} tenants
          </p>
        </div>
        <button
          onClick={() => setEditing({})}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white glow-primary"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Add Tenant
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or unit..."
          className="w-full rounded-xl border border-border bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Desktop table */}
      <div className="card-surface overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Name</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Unit</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Phone</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Rent</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Owing</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Next Due</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered?.map((t) => {
              const tenantPayments = paymentsByTenant[t.id] ?? [];
              const { due, status } = outstandingForDueMonth(t.rent_amount, t.next_due_date, tenantPayments);
              const overdue = isOverdue(t.next_due_date) && status !== "paid";
              const initials = t.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              return (
                <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0"
                        style={{ background: "#166534" }}
                      >
                        {initials}
                      </div>
                      <div>
                        <div className="font-medium">{t.full_name}</div>
                        {t.email && <div className="text-xs text-muted-foreground">{t.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{t.unit}</td>
                  <td className="py-3 text-muted-foreground">{t.phone ?? "—"}</td>
                  <td className="py-3">{formatKES(t.rent_amount)}</td>
                  <td className="py-3 font-medium">
                    {due > 0
                      ? <span style={{ color: "#DC2626" }}>({formatKES(due)})</span>
                      : <span style={{ color: "#16A34A" }}>Clear</span>
                    }
                  </td>
                  <td className="py-3">
                    {t.next_due_date ? (
                      <span className={`text-xs font-medium ${overdue ? "text-red-600" : "text-muted-foreground"}`}>
                        {t.next_due_date}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-3"><StatusPill status={status as any} /></td>
                  <td className="py-3 pr-5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <ReminderButton
                        tenant={t}
                        payments={tenantPayments}
                        property={propertyPayment}
                      />
                      <button
                        onClick={() => setViewingHistory(t)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                        title="View profile"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => generateTenantCode(t.id, t.full_name)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                        title="Generate invite code"
                      >
                        <Key className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditing({ ...t })}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {!isAgent && (
                        <button
                          onClick={() => { if (confirm(`Remove ${t.full_name}?`)) del.mutate(t.id); }}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered?.length && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {search ? "No tenants match your search." : `No tenants yet for ${selectedProperty.name}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {filtered?.map((t) => {
          const tenantPayments = paymentsByTenant[t.id] ?? [];
          const { label, due, status } = outstandingForDueMonth(t.rent_amount, t.next_due_date, tenantPayments);
          const initials = t.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={t.id} className="card-surface p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white flex-shrink-0"
                    style={{ background: "#166534" }}
                  >
                    {initials}
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{t.full_name}</div>
                    <div className="text-xs text-muted-foreground">Unit {t.unit}</div>
                  </div>
                </div>
                <StatusPill status={status as any} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div>
                  <div className="text-xs text-muted-foreground">Rent</div>
                  <div className="font-medium">{formatKES(t.rent_amount)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Next Due</div>
                  <div className="font-medium">{t.next_due_date ?? "—"}</div>
                </div>
                {due > 0 && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Owing · {label}</div>
                    <div className="font-medium" style={{ color: "#DC2626" }}>{formatKES(due)}</div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <ReminderButton
                  tenant={t}
                  payments={tenantPayments}
                  property={propertyPayment}
                />
                <button
                  onClick={() => setViewingHistory(t)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  onClick={() => generateTenantCode(t.id, t.full_name)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  title="Generate invite code"
                >
                  <Key className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditing({ ...t })}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {!isAgent && (
                  <button
                    onClick={() => { if (confirm(`Remove ${t.full_name}?`)) del.mutate(t.id); }}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!filtered?.length && (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground">
            {search ? "No tenants match your search." : `No tenants yet for ${selectedProperty.name}.`}
          </div>
        )}
      </div>

      {editing !== null && (
        <TenantForm
          initial={editing}
          onSave={(t) => upsert.mutate(t)}
          onClose={() => setEditing(null)}
          saving={upsert.isPending}
          vacantUnits={vacantUnits ?? []}
        />
      )}

      {viewingHistory && (
        <TenantProfile
          tenant={viewingHistory}
          onClose={() => setViewingHistory(null)}
        />
      )}

      {tenantCode && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card-surface w-full max-w-sm p-6 animate-slide-up text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
              <Key className="h-7 w-7" style={{ color: "#166534" }} />
            </div>
            <h2 className="font-display text-xl font-semibold mb-1">Tenant Invite Code</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Share this code with <span className="font-medium text-foreground">{tenantCode.name}</span> so they can access their portal.
            </p>
            <div className="flex items-center justify-between rounded-xl border-2 px-4 py-3 mb-4" style={{ borderColor: "#166534", background: "#F0FDF4" }}>
              <span className="font-mono text-2xl font-bold tracking-widest" style={{ color: "#166534" }}>{tenantCode.code}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(tenantCode.code); toast.success("Code copied!"); }}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">This code can only be used once.</p>
            <button
              onClick={() => setTenantCode(null)}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "#166534" }}
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function TenantProfile({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { data: payments, isLoading } = useQuery({
    queryKey: ["tenant-payments", tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("paid_on", { ascending: true });
      if (error) throw error;
      return data as any as Payment[];
    },
  });

  const { label, due, status } = outstandingForDueMonth(
    tenant.rent_amount,
    tenant.next_due_date,
    payments ?? [],
  );
  const overdue = isOverdue(tenant.next_due_date) && status !== "paid";
  const initials = tenant.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const chartData = payments?.map((p) => ({
    month: p.payment_month ?? formatDate(p.paid_on),
    amount: Number(p.amount),
  })) ?? [];

  // Render via a portal directly onto document.body so this modal isn't
  // affected by the page's animated <main> wrapper (a transformed ancestor
  // breaks `position: fixed`, making the modal open offset by the page's
  // scroll position instead of pinned to the true top of the screen).
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-4 p-5 rounded-t-xl" style={{ background: "#166534" }}>
          <div
            className="grid h-12 w-12 place-items-center rounded-full text-lg font-bold text-white flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.2)" }}
          >
            {initials}
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-bold text-white">{tenant.full_name}</h2>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>Unit {tenant.unit}</p>
          </div>
          <StatusPill status={status as any} />
          <button onClick={onClose} className="text-white/70 hover:text-white ml-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Details grid */}
          <div className="grid grid-cols-3 gap-3">
            {tenant.move_in_date && (
              <div className="rounded-xl p-3" style={{ background: "#F5F5F0" }}>
                <div className="text-xs text-muted-foreground mb-1">Move-in Date</div>
                <div className="text-sm font-semibold">{tenant.move_in_date}</div>
              </div>
            )}
            {tenant.deposit != null && Number(tenant.deposit) > 0 && (
              <div className="rounded-xl p-3" style={{ background: "#F5F5F0" }}>
                <div className="text-xs text-muted-foreground mb-1">Deposit Held</div>
                <div className="text-sm font-semibold">{formatKES(tenant.deposit)}</div>
              </div>
            )}
            {tenant.advance_months != null && Number(tenant.advance_months) > 0 && (
              <div className="rounded-xl p-3" style={{ background: "#F5F5F0" }}>
                <div className="text-xs text-muted-foreground mb-1">Advance Months</div>
                <div className="text-sm font-semibold">{tenant.advance_months} months</div>
              </div>
            )}
            {tenant.next_due_date && (
              <div className="rounded-xl p-3" style={{ background: "#F5F5F0" }}>
                <div className="text-xs text-muted-foreground mb-1">Next Due Date</div>
                <div className={`text-sm font-semibold ${overdue ? "text-red-600" : "text-green-700"}`}>
                  {tenant.next_due_date}
                </div>
              </div>
            )}
            {tenant.phone && (
              <div className="rounded-xl p-3" style={{ background: "#F5F5F0" }}>
                <div className="text-xs text-muted-foreground mb-1">Phone</div>
                <div className="text-sm font-semibold">{tenant.phone}</div>
              </div>
            )}
            <div className="rounded-xl p-3" style={{ background: "#F5F5F0" }}>
              <div className="text-xs text-muted-foreground mb-1">Monthly Rent</div>
              <div className="text-sm font-semibold">{formatKES(tenant.rent_amount)}</div>
            </div>
          </div>

          {/* Outstanding for the due month */}
          <div className="flex items-center justify-between rounded-xl p-3" style={{ background: "#F5F5F0" }}>
            <span className="text-sm text-muted-foreground">Owing · {label}</span>
            <span className={`text-sm font-bold ${due === 0 ? "text-green-700" : "text-red-600"}`}>
              {due === 0 ? "Cleared" : `(${formatKES(due)})`}
            </span>
          </div>

          {/* Payment trend chart */}
          {chartData.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Payment Trend ({chartData[0]?.month} – {chartData[chartData.length - 1]?.month})
              </h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v: number) => formatKES(v)} />
                    <Bar dataKey="amount" fill="#166534" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Payment history */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Payment History</h3>
            {isLoading && <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>}
            {!isLoading && payments?.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">No payments recorded yet.</div>
            )}
            <div className="space-y-2">
              {[...(payments ?? [])].reverse().map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: "#DCFCE7", color: "#166534" }}
                      >
                        {p.payment_month ?? formatDate(p.paid_on)}
                      </span>
                      <span
                        className="rounded-md px-2 py-0.5 text-xs font-medium"
                        style={p.method === "mpesa"
                          ? { background: "#DCFCE7", color: "#166534" }
                          : p.method === "bank"
                          ? { background: "#EFF6FF", color: "#2563EB" }
                          : { background: "#F5F5F0", color: "#6B7280" }
                        }
                      >
                        {p.method === "mpesa" ? "M-Pesa" : p.method === "bank" ? "Bank Transfer" : "Cash"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(p.paid_on)}
                      {p.reference && ` · ${p.reference}`}
                    </div>
                  </div>
                  <div className="font-display font-bold text-sm" style={{ color: "#16A34A" }}>
                    +{formatKES(p.amount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TenantForm({ initial, onSave, onClose, saving, vacantUnits }: {
  initial: Partial<Tenant>;
  onSave: (t: Partial<Tenant> & { paid_months?: string[] }) => void;
  onClose: () => void;
  saving: boolean;
  vacantUnits: { id: string; unit_name: string; rent_price: number }[];
}) {
  const [form, setForm] = useState<Partial<Tenant>>(initial);
  const set = <K extends keyof Tenant>(k: K, v: Tenant[K]) => setForm((p) => ({ ...p, [k]: v }));
  const [useDropdown, setUseDropdown] = useState(!initial.id && vacantUnits.length > 0);

  // Mode: "new" tenant (advance months) vs "existing" tenant (back-fill paid
  // years/months). Editing an existing record defaults to "existing" so the
  // landlord can fix their history.
  const [mode, setMode] = useState<"new" | "existing">(initial.id ? "existing" : "new");

  // Set of "Month Year" labels the landlord has marked as paid.
  const [paidMonths, setPaidMonths] = useState<Set<string>>(new Set());
  // Which year's month-dropdown is currently expanded (null = none).
  const [openYear, setOpenYear] = useState<number | null>(null);

  const MONTHS_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Compute the eligible months for each year between move-in and now.
  // - move-in year: from the move-in month onward
  // - current year: up to the current month
  // - middle years: all 12 months
  const now = new Date();
  const moveIn = form.move_in_date ? new Date(form.move_in_date + "T00:00:00") : null;
  const yearBlocks: { year: number; months: { label: string; monthIndex: number }[] }[] = [];
  if (moveIn && !isNaN(moveIn.getTime())) {
    const startYear = moveIn.getFullYear();
    const endYear = now.getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      const firstMonth = y === startYear ? moveIn.getMonth() : 0;
      const lastMonth = y === endYear ? now.getMonth() : 11;
      const months: { label: string; monthIndex: number }[] = [];
      for (let m = firstMonth; m <= lastMonth; m++) {
        months.push({ label: `${MONTHS_FULL[m]} ${y}`, monthIndex: m });
      }
      if (months.length > 0) yearBlocks.push({ year: y, months });
    }
  }

  // Toggle a single month.
  const toggleMonth = (label: string) => {
    setPaidMonths((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  // Toggle a whole year (all its eligible months on/off).
  const toggleYear = (block: { year: number; months: { label: string; monthIndex: number }[] }) => {
    const allSelected = block.months.every((m) => paidMonths.has(m.label));
    setPaidMonths((prev) => {
      const next = new Set(prev);
      block.months.forEach((m) => { if (allSelected) next.delete(m.label); else next.add(m.label); });
      return next;
    });
  };

  // Render via a portal directly onto document.body so this modal isn't
  // affected by the page's animated <main> wrapper (a transformed ancestor
  // breaks `position: fixed`, making the modal open offset by the page's
  // scroll position instead of pinned to the true top of the screen).
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial.id ? "Edit Tenant" : "Add Tenant"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>

        {/* New vs Existing tenant mode */}
        <div className="flex gap-1 rounded-xl p-1 mb-5" style={{ background: "#F5F5F0" }}>
          <button
            type="button"
            onClick={() => setMode("new")}
            style={{ flex: 1, padding: "8px 0", fontSize: "0.8rem", fontWeight: 600, borderRadius: "10px", border: "none", cursor: "pointer", background: mode === "new" ? "#166534" : "transparent", color: mode === "new" ? "#fff" : "#6B7280", transition: "all 0.15s" }}
          >
            New Tenant
          </button>
          <button
            type="button"
            onClick={() => setMode("existing")}
            style={{ flex: 1, padding: "8px 0", fontSize: "0.8rem", fontWeight: 600, borderRadius: "10px", border: "none", cursor: "pointer", background: mode === "existing" ? "#166534" : "transparent", color: mode === "existing" ? "#fff" : "#6B7280", transition: "all 0.15s" }}
          >
            Existing Tenant
          </button>
        </div>
        {mode === "existing" && (
          <p className="text-xs text-muted-foreground mb-4 -mt-2">
            For a tenant who has been renting for a while. Set their move-in date, then tick the years or months they've already paid — those months will be marked Paid.
          </p>
        )}

        <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, paid_months: mode === "existing" ? Array.from(paidMonths) : [] }); }} className="grid gap-3 sm:grid-cols-2">
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
            {!initial.id && vacantUnits.length > 0 && useDropdown ? (
              <div className="space-y-1">
                <select
                  required
                  value={form.unit ?? ""}
                  onChange={(e) => {
                    const u = vacantUnits.find((x) => x.unit_name === e.target.value);
                    set("unit", e.target.value);
                    if (u) set("rent_amount", Number(u.rent_price));
                  }}
                  className="form-input"
                >
                  <option value="">Select vacant unit…</option>
                  {vacantUnits.map((u) => (
                    <option key={u.id} value={u.unit_name}>{u.unit_name} — {formatKES(u.rent_price)}/mo</option>
                  ))}
                </select>
                <button type="button" onClick={() => { setUseDropdown(false); set("unit", ""); }} className="text-xs" style={{ color: "#166534" }}>
                  Enter unit manually instead
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <input required value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value)} className="form-input" />
                {!initial.id && vacantUnits.length > 0 && (
                  <button type="button" onClick={() => setUseDropdown(true)} className="text-xs" style={{ color: "#166534" }}>
                    Choose from vacant units instead
                  </button>
                )}
              </div>
            )}
          </FormField>
          <FormField label="Due day (1-31)">
            <input type="number" min={1} max={31} value={form.due_day ?? 1} onChange={(e) => set("due_day", Math.min(31, Math.max(1, Number(e.target.value))))} className="form-input" />
          </FormField>
          <FormField label="Monthly rent (KES)">
            <input type="number" min={0} value={form.rent_amount ?? 0} onChange={(e) => set("rent_amount", Number(e.target.value))} className="form-input" />
          </FormField>
          <FormField label="Deposit (KES) — optional">
            <input type="number" min={0} value={form.deposit ?? ""} onChange={(e) => set("deposit", e.target.value ? Number(e.target.value) : null as any)} className="form-input" placeholder="Leave blank if none" />
          </FormField>
          <FormField label="Move-in date">
            <input
              type="date"
              value={form.move_in_date ?? ""}
              onChange={(e) => set("move_in_date", e.target.value)}
              className="form-input"
            />
          </FormField>
          {mode === "new" && (
            <FormField label="Advance months paid">
              <input type="number" min={0} max={24} value={form.advance_months ?? 0} onChange={(e) => set("advance_months", Number(e.target.value))} className="form-input" />
            </FormField>
          )}

          {mode === "existing" && (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-foreground">Months already paid</label>
              {!form.move_in_date ? (
                <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground text-center">
                  Set the move-in date above to choose paid months.
                </div>
              ) : yearBlocks.length === 0 ? (
                <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground text-center">
                  No months to show for that move-in date.
                </div>
              ) : (
                <div className="space-y-2">
                  {yearBlocks.map((block) => {
                    const allSelected = block.months.every((m) => paidMonths.has(m.label));
                    const someSelected = block.months.some((m) => paidMonths.has(m.label));
                    const selectedCount = block.months.filter((m) => paidMonths.has(m.label)).length;
                    const isOpen = openYear === block.year;
                    return (
                      <div key={block.year} className="rounded-xl border border-border overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2.5" style={{ background: "#F9FAFB" }}>
                          <button
                            type="button"
                            onClick={() => toggleYear(block)}
                            className="flex items-center gap-2 text-left"
                          >
                            <span
                              className="grid h-5 w-5 place-items-center rounded border-2 flex-shrink-0"
                              style={{
                                borderColor: allSelected ? "#166534" : someSelected ? "#166534" : "#D1D5DB",
                                background: allSelected ? "#166534" : "transparent",
                              }}
                            >
                              {allSelected && <span style={{ color: "#fff", fontSize: "0.7rem", lineHeight: 1 }}>✓</span>}
                              {someSelected && !allSelected && <span style={{ color: "#166534", fontSize: "0.9rem", lineHeight: 1 }}>–</span>}
                            </span>
                            <span className="text-sm font-semibold text-foreground">{block.year}</span>
                            <span className="text-xs text-muted-foreground">
                              {selectedCount > 0 ? `${selectedCount}/${block.months.length} paid` : `${block.months.length} months`}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenYear(isOpen ? null : block.year)}
                            className="text-xs font-medium"
                            style={{ color: "#166534" }}
                          >
                            {isOpen ? "Hide months" : "Choose months"}
                          </button>
                        </div>
                        {isOpen && (
                          <div className="grid grid-cols-2 gap-1 p-2">
                            {block.months.map((m) => {
                              const checked = paidMonths.has(m.label);
                              return (
                                <button
                                  key={m.label}
                                  type="button"
                                  onClick={() => toggleMonth(m.label)}
                                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors"
                                  style={{ background: checked ? "#F0FDF4" : "transparent", border: `1px solid ${checked ? "#BBF7D0" : "#E5E7EB"}` }}
                                >
                                  <span
                                    className="grid h-4 w-4 place-items-center rounded border-2 flex-shrink-0"
                                    style={{ borderColor: checked ? "#166534" : "#D1D5DB", background: checked ? "#166534" : "transparent" }}
                                  >
                                    {checked && <span style={{ color: "#fff", fontSize: "0.6rem", lineHeight: 1 }}>✓</span>}
                                  </span>
                                  <span className="text-xs text-foreground">{MONTHS_FULL[m.monthIndex]}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    Tap a year to mark all its months paid, or "Choose months" to pick specific ones. {paidMonths.size} month{paidMonths.size === 1 ? "" : "s"} selected.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 glow-primary"
              style={{ background: "#166534" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>,
    document.body
  );
}

function FormField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}