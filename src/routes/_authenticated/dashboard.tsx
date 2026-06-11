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
    <span
      className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
      style={styles[status]}
    >
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

  // Occupancy
  const occupied = totalTenants;
  const vacant = 0; // no vacant unit tracking yet — shows occupied count
  const occupancyRate = totalTenants > 0 ? 100 : 0;

  if (!selectedProperty) return null;

  const statCards = [
    {
      label: "Total Tenants",
      value: String(totalTenants),
      icon: Users,
      iconBg: "#EFF6FF",
      iconColor: "#2563EB",
    },
    {
      label: "Expected Rent",
      value: formatKES(expected),
      icon: Wallet,
      iconBg: "#FEF9C3",
      iconColor: "#D97706",
    },
    {
      label: "Collected",
      value: formatKES(collected),
      icon: TrendingUp,
      iconBg: "#DCFCE7",
      iconColor: "#16A34A",
    },
    {
      label: "Outstanding",
      value: formatKES(outstanding),
      icon: AlertCircle,
      iconBg: "#FEE2E2",
      iconColor: "#DC2626",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">{selectedProperty.name}</h1>
        {selectedProperty.location && (
          <p className="text-sm text-muted-foreground mt-0.5">{selectedProperty.location}</p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card-surface p-5">
              <div className="flex items-start justify-between mb-3">
                <div
                  className="grid h-10 w-10 place-items-center rounded-xl"
                  style={{ background: s.iconBg }}
                >
                  <Icon className="h-5 w-5" style={{ color: s.iconColor }} />
                </div>
              </div>
              <div className="text-xs font-medium text-muted-foreground mb-1">{s.label}</div>
              <div className="font-display text-xl font-bold text-foreground">{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Occupancy Overview */}
      <div className="card-surface p-5">
        <h2 className="font-display text-base font-semibold mb-4">Occupancy Overview</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-4 text-center" style={{ background: "#F5F5F0" }}>
            <div className="grid h-10 w-10 place-items-center rounded-xl mx-auto mb-2" style={{ background: "#EFF6FF" }}>
              <Building2 className="h-5 w-5" style={{ color: "#2563EB" }} />
            </div>
            <div className="font-display text-2xl font-bold text-foreground">{totalTenants}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total Units</div>
          </div>
          <div className="rounded-xl p-4 text-center" style={{ background: "#F5F5F0" }}>
            <div className="grid h-10 w-10 place-items-center rounded-xl mx-auto mb-2" style={{ background: "#DCFCE7" }}>
              <DoorOpen className="h-5 w-5" style={{ color: "#16A34A" }} />
            </div>
            <div className="font-display text-2xl font-bold" style={{ color: "#16A34A" }}>{occupied}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Occupied</div>
          </div>
          <div className="rounded-xl p-4 text-center" style={{ background: "#F5F5F0" }}>
            <div className="grid h-10 w-10 place-items-center rounded-xl mx-auto mb-2" style={{ background: "#FEE2E2" }}>
              <DoorClosed className="h-5 w-5" style={{ color: "#DC2626" }} />
            </div>
            <div className="font-display text-2xl font-bold" style={{ color: "#DC2626" }}>{vacant}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Vacant</div>
          </div>
        </div>
        {/* Occupancy bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Occupancy Rate</span>
            <span className="font-semibold text-foreground">{occupancyRate}%</span>
          </div>
          <div className="h-2.5 rounded-full w-full" style={{ background: "#E5E7EB" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${occupancyRate}%`, background: "#166534" }}
            />
          </div>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tenant overview */}
        <div className="card-surface lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-display text-base font-semibold">Tenant Overview</h2>
            <span className="text-xs text-muted-foreground">{collectionRate}% collected</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
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
                      <td className="py-3">{formatKES(t.rent_amount)}</td>
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