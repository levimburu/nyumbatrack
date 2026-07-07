import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Wallet, TrendingUp, AlertCircle, CheckCircle2, Building2, DoorOpen, DoorClosed, Key, Copy, X, Receipt } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatKES, formatDate } from "@/lib/format";
import { useProperty } from "@/context/PropertyContext";
import { TenantPaymentView, type TenantMin } from "./payments";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

export function StatusPill({ status }: { status: "paid" | "partial" | "unpaid" }) {
  const styles = {
    paid: { background: "#DCFCE7", color: "#166534" },
    partial: { background: "#FEF9C3", color: "#854D0E" },
    unpaid: { background: "#FEE2E2", color: "#991B1B" },
  };
  const labels = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
  return (
    <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold" style={styles[status]}>
      {labels[status]}
    </span>
  );
}

function Dashboard() {
  const { selectedProperty } = useProperty();
  const navigate = useNavigate();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isAgent, setIsAgent] = useState(false);
  const [breakdown, setBreakdown] = useState<null | "collected" | "outstanding" | "expected">(null);
  const [openTenant, setOpenTenant] = useState<TenantMin | null>(null);

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

  const generateInviteCode = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !selectedProperty) return;
    const code = "NYM-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await (supabase as any).from("invite_codes").insert({
      landlord_id: user.id,
      property_id: selectedProperty.id,
      code,
    });
    if (error) { toast.error("Failed to generate code"); return; }
    setGeneratedCode(code);
    setShowInviteModal(true);
  };

  useEffect(() => {
    if (!selectedProperty) navigate({ to: "/properties" });
  }, [selectedProperty, navigate]);

  const { data: tenants } = useQuery({
    queryKey: ["tenants", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("*")
        .eq("property_id", selectedProperty!.id)
        .order("unit");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: propertyData } = useQuery({
    queryKey: ["property-detail", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("properties")
        .select("total_units")
        .eq("id", selectedProperty!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { total_units: number };
    },
  });

  const { data: payments } = useQuery({
    queryKey: ["payments-recent", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("*, tenants(full_name, unit, property_id)")
        .order("paid_on", { ascending: false })
        .limit(10);
      if (error) throw error;
      const all = data as any[];
      return all.filter((p) => p.tenants?.property_id === selectedProperty!.id).slice(0, 5);
    },
  });

  const currentMonthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const { data: allPaymentsThisMonth } = useQuery({
    queryKey: ["payments-this-month", selectedProperty?.id, currentMonthLabel],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("amount, tenant_id, payment_month, paid_on, method, reference, tenants(id, full_name, unit, property_id)")
        .eq("payment_month", currentMonthLabel)
        .order("paid_on", { ascending: false });
      if (error) throw error;
      const all = data as any[];
      return all.filter((p) => p.tenants?.property_id === selectedProperty!.id);
    },
  });
  const totalTenants = tenants?.length ?? 0;
  const expected = tenants?.reduce((s, t) => s + Number(t.rent_amount), 0) ?? 0;

  // Build a map of how much each tenant has paid FOR the current month
  // (based on payment_month, so advance payments tagged for this month count).
  const paidThisMonthByTenant: Record<string, number> = {};
  (allPaymentsThisMonth ?? []).forEach((p: any) => {
    paidThisMonthByTenant[p.tenant_id] =
      (paidThisMonthByTenant[p.tenant_id] ?? 0) + Number(p.amount);
  });

  // A tenant is "covered by advance" for the current month when their
  // next_due_date falls in a LATER month than the current one — i.e. their
  // rent has already been settled through (at least) this month, typically
  // via advance payments recorded when they were added.
  const now = new Date();
  const currentYM = now.getFullYear() * 12 + now.getMonth();
  const isCoveredByAdvance = (t: any): boolean => {
    if (!t.next_due_date) return false;
    const due = new Date(t.next_due_date);
    if (isNaN(due.getTime())) return false;
    const dueYM = due.getFullYear() * 12 + due.getMonth();
    return dueYM > currentYM;
  };

  // Status for the CURRENT month. Paid if either the full rent has been paid
  // for this month OR the tenant is covered by advance (next_due beyond now).
  const getCurrentMonthStatus = (t: any): "paid" | "partial" | "unpaid" => {
    const rent = Number(t.rent_amount);
    if (isCoveredByAdvance(t)) return "paid";
    const paid = paidThisMonthByTenant[t.id] ?? 0;
    if (paid >= rent && rent > 0) return "paid";
    if (paid > 0) return "partial";
    return "unpaid";
  };

  // Collected for the current month: sum of payments tagged for this month,
  // PLUS the full rent of any advance-covered tenant who has no payment tagged
  // to this month (so their covered rent still counts once, without double-
  // counting anyone who does have a payment recorded for the month).
  const collectedFromPayments = (allPaymentsThisMonth ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const collectedFromAdvance = (tenants ?? []).reduce((s: number, t: any) => {
    if (isCoveredByAdvance(t) && !(paidThisMonthByTenant[t.id] > 0)) {
      return s + Number(t.rent_amount);
    }
    return s;
  }, 0);
  const collected = collectedFromPayments + collectedFromAdvance;
  const outstanding = Math.max(0, expected - collected);
  const collectionRate = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;

  // Arrears (historical): how many months behind, based on next_due_date.
  const today = new Date().toISOString().slice(0, 10);
  const getMonthsBehind = (t: any): number => {
    if (!t.next_due_date || t.next_due_date > today) return 0;
    const due = new Date(t.next_due_date);
    const now = new Date();
    return Math.max(1, (now.getFullYear() - due.getFullYear()) * 12 + (now.getMonth() - due.getMonth()));
  };

  // --- Breakdown lists for the tappable stat cards ---

  // Collected: the individual payments made for this month (name, unit, amount, date, method)
  const collectedList: Array<{ id: string; name: string; unit: string; amount: number; paidOn: string | null; method: string; advance?: boolean }> =
    (allPaymentsThisMonth ?? []).map((p: any) => ({
      id: p.tenant_id + "-" + p.paid_on + "-" + p.amount,
      name: p.tenants?.full_name ?? "—",
      unit: p.tenants?.unit ?? "—",
      amount: Number(p.amount),
      paidOn: p.paid_on,
      method: p.method as string,
    }));

  // Add advance-covered tenants (paid ahead, no payment tagged to this month)
  // so their covered rent is visible in the Collected breakdown too.
  (tenants ?? []).forEach((t: any) => {
    if (isCoveredByAdvance(t) && !(paidThisMonthByTenant[t.id] > 0)) {
      collectedList.push({
        id: "advance-" + t.id,
        name: t.full_name,
        unit: t.unit,
        amount: Number(t.rent_amount),
        paidOn: null,
        method: "advance",
        advance: true,
      });
    }
  });

  // Outstanding: tenants who haven't covered this month (by payment or advance),
  // with how much they still owe for the month.
  const outstandingList = (tenants ?? [])
    .map((t: any) => {
      const paid = paidThisMonthByTenant[t.id] ?? 0;
      const rent = Number(t.rent_amount);
      const owed = Math.max(0, rent - paid);
      const status = getCurrentMonthStatus(t);
      return { id: t.id, name: t.full_name, unit: t.unit, owed, paid, rent, status };
    })
    .filter((t) => t.status !== "paid" && t.owed > 0);

  // Expected: the full rent roll — every tenant and their monthly rent
  const expectedList = (tenants ?? []).map((t: any) => ({
    id: t.id,
    name: t.full_name,
    unit: t.unit,
    rent: Number(t.rent_amount),
  }));

  const totalUnits = propertyData?.total_units && propertyData.total_units > 0 ? propertyData.total_units : totalTenants;
  const occupied = totalTenants;
  const vacant = Math.max(0, totalUnits - occupied);
  const occupancyRate = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">

      {/* Hero header */}
      <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d2818 0%, #166534 100%)" }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full" style={{ background: "#F59E0B", transform: "translate(30%, -30%)" }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full" style={{ background: "#16A34A", transform: "translate(-30%, 30%)" }} />
        </div>
        <div className="relative">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white/60 text-sm font-medium mb-1">Current Property</p>
              <h1 className="font-display text-2xl font-bold text-white">{selectedProperty.name}</h1>
              {selectedProperty.location && (
                <p className="text-white/60 text-sm mt-0.5">{selectedProperty.location}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isAgent && (
                <button
                  onClick={generateInviteCode}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                  style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
                >
                  <Key className="h-3.5 w-3.5" /> Invite Agent
                </button>
              )}
              <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "rgba(255,255,255,0.15)" }}>
                <Building2 className="h-6 w-6 text-white" />
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#F59E0B", color: "#fff" }}>
              {occupancyRate}% Occupied
            </div>
            <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>
              {totalTenants} Tenants
            </div>
            <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>
              {collectionRate}% Collected
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards — 2x2 on mobile, 4 across on desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#EFF6FF" }}>
              <Users className="h-4 w-4" style={{ color: "#2563EB" }} />
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#EFF6FF", color: "#2563EB" }}>
              {totalTenants}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Total Tenants</div>
          <div className="font-display text-lg font-bold text-foreground">{totalTenants}</div>
        </div>

        <button onClick={() => setBreakdown("expected")} className="card-surface p-4 text-left hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEF9C3" }}>
              <Wallet className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Expected Rent</div>
          <div className="font-display text-lg font-bold text-foreground">{formatKES(expected)}</div>
        </button>

        <button onClick={() => setBreakdown("collected")} className="card-surface p-4 text-left hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#DCFCE7" }}>
              <TrendingUp className="h-4 w-4" style={{ color: "#16A34A" }} />
            </div>
            {collected > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#DCFCE7", color: "#166534" }}>
                {collectionRate}%
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Collected</div>
          <div className="font-display text-lg font-bold" style={{ color: "#16A34A" }}>{formatKES(collected)}</div>
        </button>

        <button onClick={() => setBreakdown("outstanding")} className="card-surface p-4 text-left hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEE2E2" }}>
              <AlertCircle className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Outstanding</div>
          <div className="font-display text-lg font-bold" style={{ color: outstanding > 0 ? "#DC2626" : "#16A34A" }}>
            {formatKES(outstanding)}
          </div>
        </button>
      </div>

      {/* Occupancy Overview */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-semibold">Occupancy Overview</h2>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: occupancyRate >= 75 ? "#DCFCE7" : occupancyRate >= 50 ? "#FEF9C3" : "#FEE2E2", color: occupancyRate >= 75 ? "#166534" : occupancyRate >= 50 ? "#854D0E" : "#991B1B" }}>
            {occupancyRate}% full
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl p-3 text-center" style={{ background: "#EFF6FF" }}>
            <div className="grid h-9 w-9 place-items-center rounded-xl mx-auto mb-2" style={{ background: "#DBEAFE" }}>
              <Building2 className="h-4 w-4" style={{ color: "#2563EB" }} />
            </div>
            <div className="font-display text-2xl font-bold text-foreground">{totalUnits}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: "#F0FDF4" }}>
            <div className="grid h-9 w-9 place-items-center rounded-xl mx-auto mb-2" style={{ background: "#DCFCE7" }}>
              <DoorOpen className="h-4 w-4" style={{ color: "#16A34A" }} />
            </div>
            <div className="font-display text-2xl font-bold" style={{ color: "#16A34A" }}>{occupied}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Occupied</div>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: vacant > 0 ? "#FFF7ED" : "#F0FDF4" }}>
            <div className="grid h-9 w-9 place-items-center rounded-xl mx-auto mb-2" style={{ background: vacant > 0 ? "#FEE2E2" : "#DCFCE7" }}>
              <DoorClosed className="h-4 w-4" style={{ color: vacant > 0 ? "#DC2626" : "#16A34A" }} />
            </div>
            <div className="font-display text-2xl font-bold" style={{ color: vacant > 0 ? "#DC2626" : "#16A34A" }}>{vacant}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Vacant</div>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>Occupancy Rate</span>
          <span className="font-semibold text-foreground">{occupancyRate}%</span>
        </div>
        <div className="h-3 rounded-full w-full overflow-hidden" style={{ background: "#E5E7EB" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${occupancyRate}%`, background: occupancyRate >= 75 ? "#166534" : occupancyRate >= 50 ? "#F59E0B" : "#DC2626" }}
          />
        </div>
      </div>

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tenant overview */}
        <div className="card-surface lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-display text-base font-semibold">Tenant Overview</h2>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: "#DCFCE7", color: "#166534" }}>
              {collectionRate}% collected
            </span>
          </div>
          <div style={{ overflowX: "scroll", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", minWidth: "680px", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-border" style={{ background: "#F9FAFB" }}>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Tenant</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Unit</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Rent</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Next Due</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Arrears</th>
                </tr>
              </thead>
              <tbody>
                {tenants?.map((t) => {
                  const status = getCurrentMonthStatus(t);
                  const monthsBehind = getMonthsBehind(t);
                  const initials = t.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setOpenTenant(t as TenantMin)}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0"
                            style={{ background: "#166534" }}
                          >
                            {initials}
                          </div>
                          <span className="font-medium">{t.full_name}</span>
                        </div>
                      </td>
                      <td className="py-3 text-muted-foreground">{t.unit}</td>
                      <td className="py-3 font-medium">{formatKES(t.rent_amount)}</td>
                      <td className="py-3"><StatusPill status={status} /></td>
                      <td className="py-3">
                        {t.next_due_date ? (
                          <span
                            className="text-xs font-medium"
                            style={{ color: t.next_due_date < today && status !== "paid" ? "#DC2626" : "#6B7280" }}
                          >
                            {formatDate(t.next_due_date)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        {monthsBehind > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                            {monthsBehind} {monthsBehind === 1 ? "month" : "months"} behind
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!tenants?.length && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      No tenants yet for this property.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent payments */}
        <div className="card-surface">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-display text-base font-semibold">Recent Payments</h2>
          </div>
          <ul className="divide-y divide-border">
            {payments?.length ? payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <div
                  className="grid h-8 w-8 place-items-center rounded-full flex-shrink-0"
                  style={{ background: "#DCFCE7" }}
                >
                  <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.tenants?.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.payment_month ?? formatDate(p.paid_on)}
                  </div>
                </div>
                <div className="font-display text-sm font-bold" style={{ color: "#16A34A" }}>
                  +{formatKES(p.amount)}
                </div>
              </li>
            )) : (
              <li className="px-5 py-6 text-sm text-muted-foreground text-center">No payments yet.</li>
            )}
          </ul>
        </div>
      </div>
    {showInviteModal && generatedCode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card-surface w-full max-w-sm p-6 animate-slide-up text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
              <Key className="h-7 w-7" style={{ color: "#166534" }} />
            </div>
            <h2 className="font-display text-xl font-semibold mb-2">Agent Invite Code</h2>
            <p className="text-sm text-muted-foreground mb-2">
              Share this code with your agent for <span className="font-semibold text-foreground">{selectedProperty.name}</span>.
            </p>
            <p className="text-xs text-muted-foreground mb-6">They'll only have access to this property.</p>
            <div className="flex items-center justify-between rounded-xl border-2 px-4 py-3 mb-4" style={{ borderColor: "#166534", background: "#F0FDF4" }}>
              <span className="font-mono text-2xl font-bold tracking-widest" style={{ color: "#166534" }}>{generatedCode}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(generatedCode); toast.success("Code copied!"); }}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">This code can only be used once.</p>
            <button
              onClick={() => { setShowInviteModal(false); setGeneratedCode(null); }}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "#166534" }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Breakdown modal for Collected / Outstanding / Expected cards */}
      {breakdown && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setBreakdown(null)} />
          <div className="relative w-full max-w-md h-full bg-white flex flex-col shadow-2xl">
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{
                background:
                  breakdown === "collected" ? "#166534" :
                  breakdown === "outstanding" ? "#991B1B" : "#0d2818",
              }}
            >
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  {breakdown === "collected" ? "Collected This Month" :
                   breakdown === "outstanding" ? "Outstanding This Month" : "Expected Rent"}
                </h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {breakdown === "collected" ? `${currentMonthLabel} · ${formatKES(collected)}` :
                   breakdown === "outstanding" ? `${currentMonthLabel} · ${formatKES(outstanding)} owed` :
                   `Monthly rent roll · ${formatKES(expected)}`}
                </p>
              </div>
              <button onClick={() => setBreakdown(null)} className="text-white/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {/* COLLECTED */}
              {breakdown === "collected" && (
                collectedList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="grid h-16 w-16 place-items-center rounded-2xl mb-4" style={{ background: "#F5F5F0" }}>
                      <Receipt className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-medium text-foreground mb-1">No payments yet this month</p>
                    <p className="text-sm text-muted-foreground">Payments recorded for {currentMonthLabel} will appear here.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {collectedList.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-5 py-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-foreground truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Unit {p.unit}{p.advance ? " · covered by advance" : ` · ${formatDate(p.paidOn as string)}`}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="font-display font-bold text-sm" style={{ color: "#16A34A" }}>
                            +{formatKES(p.amount)}
                          </div>
                          <span
                            className="inline-block rounded-md px-2 py-0.5 text-xs font-medium mt-0.5"
                            style={
                              p.advance ? { background: "#EDE9FE", color: "#6D28D9" } :
                              p.method === "mpesa" ? { background: "#DCFCE7", color: "#166534" } :
                              p.method === "bank" ? { background: "#EFF6FF", color: "#2563EB" } :
                              { background: "#F5F5F0", color: "#6B7280" }
                            }
                          >
                            {p.advance ? "Advance" : p.method === "mpesa" ? "M-Pesa" : p.method === "bank" ? "Bank Transfer" : "Cash"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* OUTSTANDING */}
              {breakdown === "outstanding" && (
                outstandingList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="grid h-16 w-16 place-items-center rounded-2xl mb-4" style={{ background: "#DCFCE7" }}>
                      <CheckCircle2 className="h-8 w-8" style={{ color: "#16A34A" }} />
                    </div>
                    <p className="font-medium text-foreground mb-1">Everyone's paid up!</p>
                    <p className="text-sm text-muted-foreground">No outstanding rent for {currentMonthLabel}.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {outstandingList.map((t) => (
                      <div key={t.id} className="flex items-center justify-between px-5 py-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-foreground truncate">{t.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Unit {t.unit}
                            {t.status === "partial" && ` · paid ${formatKES(t.paid)} of ${formatKES(t.rent)}`}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="font-display font-bold text-sm" style={{ color: "#DC2626" }}>
                            {formatKES(t.owed)}
                          </div>
                          <span
                            className="inline-block rounded-md px-2 py-0.5 text-xs font-medium mt-0.5"
                            style={
                              t.status === "partial"
                                ? { background: "#FEF9C3", color: "#854D0E" }
                                : { background: "#FEE2E2", color: "#991B1B" }
                            }
                          >
                            {t.status === "partial" ? "Partial" : "Unpaid"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* EXPECTED */}
              {breakdown === "expected" && (
                expectedList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="grid h-16 w-16 place-items-center rounded-2xl mb-4" style={{ background: "#F5F5F0" }}>
                      <Wallet className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-medium text-foreground mb-1">No tenants yet</p>
                    <p className="text-sm text-muted-foreground">Add tenants to see the expected rent breakdown.</p>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-border">
                      {expectedList.map((t) => (
                        <div key={t.id} className="flex items-center justify-between px-5 py-3">
                          <div className="min-w-0">
                            <div className="font-medium text-sm text-foreground truncate">{t.name}</div>
                            <div className="text-xs text-muted-foreground">Unit {t.unit}</div>
                          </div>
                          <div className="font-display font-bold text-sm text-foreground flex-shrink-0 ml-3">
                            {formatKES(t.rent)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between px-5 py-4 border-t-2 border-border" style={{ background: "#F9FAFB" }}>
                      <span className="text-sm font-semibold text-foreground">Total Expected</span>
                      <span className="font-display font-bold text-foreground">{formatKES(expected)}</span>
                    </div>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tenant payment view — opens in place over the dashboard */}
      {openTenant && (
        <TenantPaymentView
          tenant={openTenant}
          onClose={() => setOpenTenant(null)}
        />
      )}
    </div>
  );
}