import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Plus, Pencil, Trash2, X, Eye, Search, Key, Copy } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "./dashboard";
import { useProperty } from "@/context/PropertyContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

  const filtered = data?.filter((t) =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.unit.toLowerCase().includes(search.toLowerCase())
  );

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
        const advanceMonths = t.advance_months ?? 0;
        let nextDueDate = null;
        // Determine the month the advance coverage starts from: the move-in
        // month if provided, otherwise the current month.
        const startBase = t.move_in_date
          ? new Date(t.move_in_date + "T00:00:00")
          : new Date();
        if (t.move_in_date) {
          const nextDue = new Date(
            startBase.getFullYear(),
            startBase.getMonth() + advanceMonths + 1,
            t.due_day ?? 1
          );
          nextDueDate = nextDue.toISOString().slice(0, 10);
        }

        // Insert the tenant and get its id back so we can attach advance payments.
        const { data: inserted, error } = await (supabase as any)
          .from("tenants")
          .insert({
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
            advance_months: advanceMonths,
            next_due_date: nextDueDate,
          })
          .select("id")
          .single();
        if (error) throw error;

        // If the tenant prepaid, auto-create one payment record per covered
        // month (starting from the move-in/current month), each tagged to that
        // month so it shows Paid everywhere. No advance = nothing created, so
        // the tenant correctly stays Unpaid until a real payment is recorded.
        if (inserted?.id && advanceMonths > 0 && (t.rent_amount ?? 0) > 0) {
          const MONTHS_FULL = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
          ];
          const paidOn = new Date().toISOString().slice(0, 10);
          const advanceRecords = [];
          for (let i = 0; i < advanceMonths; i++) {
            const d = new Date(startBase.getFullYear(), startBase.getMonth() + i, 1);
            advanceRecords.push({
              tenant_id: inserted.id,
              amount: t.rent_amount ?? 0,
              paid_on: paidOn,
              method: "advance",
              payment_month: `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`,
              reference: "Advance payment on enrollment",
            });
          }
          const { error: payError } = await (supabase as any)
            .from("payments")
            .insert(advanceRecords);
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
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Balance</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Next Due</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered?.map((t) => {
              const status = Number(t.balance) === 0 ? "paid" : Number(t.balance) < Number(t.rent_amount) ? "partial" : "unpaid";
              const isOverdue = t.next_due_date && new Date(t.next_due_date) < new Date() && status !== "paid";
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
                    {Number(t.balance) > 0
                      ? <span style={{ color: "#DC2626" }}>({formatKES(t.balance)})</span>
                      : <span style={{ color: "#16A34A" }}>Clear</span>
                    }
                  </td>
                  <td className="py-3">
                    {t.next_due_date ? (
                      <span className={`text-xs font-medium ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
                        {t.next_due_date}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-3"><StatusPill status={status as any} /></td>
                  <td className="py-3 pr-5 text-right">
                    <div className="inline-flex gap-1">
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
          const status = Number(t.balance) === 0 ? "paid" : Number(t.balance) < Number(t.rent_amount) ? "partial" : "unpaid";
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
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
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
                <button
                  onClick={() => { if (confirm(`Remove ${t.full_name}?`)) del.mutate(t.id); }}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
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

      {tenantCode && (
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
        </div>
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

  const status = Number(tenant.balance) === 0 ? "paid" : Number(tenant.balance) < Number(tenant.rent_amount) ? "partial" : "unpaid";
  const nextDue = tenant.next_due_date ? new Date(tenant.next_due_date) : null;
  const isOverdue = nextDue && nextDue < new Date();
  const initials = tenant.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const chartData = payments?.map((p) => ({
    month: p.payment_month ?? formatDate(p.paid_on),
    amount: Number(p.amount),
  })) ?? [];

  return (
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
                <div className={`text-sm font-semibold ${isOverdue ? "text-red-600" : "text-green-700"}`}>
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

          {/* Balance */}
          <div className="flex items-center justify-between rounded-xl p-3" style={{ background: "#F5F5F0" }}>
            <span className="text-sm text-muted-foreground">Current Balance</span>
            <span className={`text-sm font-bold ${Number(tenant.balance) === 0 ? "text-green-700" : "text-red-600"}`}>
              {Number(tenant.balance) === 0 ? "Cleared" : `(${formatKES(tenant.balance)})`}
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
    </div>
  );
}



function TenantForm({ initial, onSave, onClose, saving, vacantUnits }: {
  initial: Partial<Tenant>;
  onSave: (t: Partial<Tenant>) => void;
  onClose: () => void;
  saving: boolean;
  vacantUnits: { id: string; unit_name: string; rent_price: number }[];
}) {
  const [form, setForm] = useState<Partial<Tenant>>(initial);
  const set = <K extends keyof Tenant>(k: K, v: Tenant[K]) => setForm((p) => ({ ...p, [k]: v }));
  const [useDropdown, setUseDropdown] = useState(!initial.id && vacantUnits.length > 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial.id ? "Edit Tenant" : "Add Tenant"}</h2>
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
          <FormField label="Advance months paid">
            <input type="number" min={0} max={24} value={form.advance_months ?? 0} onChange={(e) => set("advance_months", Number(e.target.value))} className="form-input" />
          </FormField>
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
    </div>
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