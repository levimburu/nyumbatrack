import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Wallet, TrendingUp, AlertCircle, CheckCircle2, Building2, DoorOpen, DoorClosed } from "lucide-react";
import { formatKES, formatDate } from "@/lib/format";
import { useProperty } from "@/context/PropertyContext";

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

  const totalTenants = tenants?.length ?? 0;
  const expected = tenants?.reduce((s, t) => s + Number(t.rent_amount), 0) ?? 0;
  const outstanding = tenants?.reduce((s, t) => s + Number(t.balance), 0) ?? 0;
  const collected = expected - outstanding;
  const collectionRate = expected ? Math.round((collected / expected) * 100) : 0;

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
            <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "rgba(255,255,255,0.15)" }}>
              <Building2 className="h-6 w-6 text-white" />
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

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEF9C3" }}>
              <Wallet className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Expected Rent</div>
          <div className="font-display text-lg font-bold text-foreground">{formatKES(expected)}</div>
        </div>

        <div className="card-surface p-4">
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
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEE2E2" }}>
              <AlertCircle className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Outstanding</div>
          <div className="font-display text-lg font-bold" style={{ color: outstanding > 0 ? "#DC2626" : "#16A34A" }}>
            {formatKES(outstanding)}
          </div>
        </div>
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
        <div className="card-surface lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-display text-base font-semibold">Tenant Overview</h2>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: "#DCFCE7", color: "#166534" }}>
              {collectionRate}% collected
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border" style={{ background: "#F9FAFB" }}>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Tenant</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Unit</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Rent</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants?.map((t) => {
                  const status = Number(t.balance) === 0 ? "paid" : Number(t.balance) < Number(t.rent_amount) ? "partial" : "unpaid";
                  const initials = t.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
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
                          <span className="font-medium">{t.full_name}</span>
                        </div>
                      </td>
                      <td className="py-3 text-muted-foreground">{t.unit}</td>
                      <td className="py-3 font-medium">{formatKES(t.rent_amount)}</td>
                      <td className="py-3"><StatusPill status={status} /></td>
                    </tr>
                  );
                })}
                {!tenants?.length && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-sm text-muted-foreground">
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
    </div>
  );
}