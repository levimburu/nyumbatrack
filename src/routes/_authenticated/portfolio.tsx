import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { useProperty } from "@/context/PropertyContext";
import {
  Building2, Users, Wallet, TrendingUp, AlertCircle, DoorOpen, DoorClosed, LayoutGrid,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/portfolio")({
  component: PortfolioDashboard,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  total_units: number;
  user_id: string;
}

interface Tenant {
  id: string;
  property_id: string;
  full_name: string;
  unit: string;
  rent_amount: number;
  next_due_date: string | null;
}

interface Payment {
  amount: number;
  tenant_id: string;
  payment_month: string;
  paid_on: string;
  property_id: string; // resolved from the joined tenant below
}

function PortfolioDashboard() {
  const navigate = useNavigate();
  const { setSelectedProperty } = useProperty();
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .maybeSingle();
      setIsAgent(data?.role === "agent");
      setFullName(data?.full_name ?? "");
      setProfileLoaded(true);
    });
  }, []);

  // All properties belonging to the logged-in landlord.
  const { data: properties, isLoading: propsLoading } = useQuery({
    queryKey: ["portfolio-properties", profileLoaded],
    enabled: profileLoaded && isAgent === false,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await (supabase as any)
        .from("properties")
        .select("id, name, location, total_units, user_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Property[];
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);

  // Every tenant across all those properties.
  const { data: tenants } = useQuery({
    queryKey: ["portfolio-tenants", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, property_id, full_name, unit, rent_amount, next_due_date")
        .in("property_id", propertyIds);
      if (error) throw error;
      return data as Tenant[];
    },
  });

  // Payments tagged for the current month, joined to tenant so we can map
  // each one back to its property.
  const currentMonthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const { data: monthPayments } = useQuery({
    queryKey: ["portfolio-month-payments", propertyIds.join(","), currentMonthLabel],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("amount, tenant_id, payment_month, paid_on, tenants(property_id)")
        .eq("payment_month", currentMonthLabel);
      if (error) throw error;
      return (data as any[])
        .filter((p) => propertyIds.includes(p.tenants?.property_id))
        .map((p) => ({ ...p, property_id: p.tenants?.property_id })) as Payment[];
    },
  });

  // Last 6 months of payments across all properties, for the trend chart.
  const { data: trendPayments } = useQuery({
    queryKey: ["portfolio-trend", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("amount, paid_on, tenants(property_id)")
        .gte("paid_on", sixMonthsAgo.toISOString().slice(0, 10));
      if (error) throw error;
      return (data as any[]).filter((p) => propertyIds.includes(p.tenants?.property_id)) as any[];
    },
  });

  // --- Aggregate stats across all properties ---
  const now = new Date();
  const currentYM = now.getFullYear() * 12 + now.getMonth();
  const isCoveredByAdvance = (t: Tenant): boolean => {
    if (!t.next_due_date) return false;
    const due = new Date(t.next_due_date);
    if (isNaN(due.getTime())) return false;
    return due.getFullYear() * 12 + due.getMonth() > currentYM;
  };

  const paidByTenant: Record<string, number> = {};
  (monthPayments ?? []).forEach((p) => {
    paidByTenant[p.tenant_id] = (paidByTenant[p.tenant_id] ?? 0) + Number(p.amount);
  });

  const totalTenants = tenants?.length ?? 0;
  const totalUnits = (properties ?? []).reduce((s, p) => {
    const occ = (tenants ?? []).filter((t) => t.property_id === p.id).length;
    return s + (p.total_units > 0 ? p.total_units : occ);
  }, 0);
  const occupiedUnits = totalTenants;
  const vacantUnits = Math.max(0, totalUnits - occupiedUnits);
  const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

  const expected = (tenants ?? []).reduce((s, t) => s + Number(t.rent_amount), 0);

  const collectedFromPayments = (monthPayments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const collectedFromAdvance = (tenants ?? []).reduce((s, t) => {
    if (isCoveredByAdvance(t) && !((paidByTenant[t.id] ?? 0) > 0)) return s + Number(t.rent_amount);
    return s;
  }, 0);
  const collected = collectedFromPayments + collectedFromAdvance;
  const outstanding = Math.max(0, expected - collected);
  const collectionRate = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;

  // Average rent per occupied unit across the whole portfolio.
  const avgRentPerUnit = occupiedUnits > 0 ? Math.round(expected / occupiedUnits) : 0;

  // Tenants in arrears (historically behind, not just unpaid this month):
  // next_due_date has already passed. Distinct from "outstanding this month" —
  // this counts people who are genuinely behind schedule.
  const todayStr = new Date().toISOString().slice(0, 10);
  const tenantsInArrears = (tenants ?? []).filter(
    (t) => t.next_due_date && t.next_due_date <= todayStr,
  ).length;

  // Build the 6-month trend series.
  const trendData = (() => {
    const buckets: { label: string; ym: number; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      buckets.push({
        label: d.toLocaleDateString("en-US", { month: "short" }),
        ym: d.getFullYear() * 12 + d.getMonth(),
        total: 0,
      });
    }
    (trendPayments ?? []).forEach((p) => {
      if (!p.paid_on) return;
      const d = new Date(p.paid_on);
      if (isNaN(d.getTime())) return;
      const ym = d.getFullYear() * 12 + d.getMonth();
      const bucket = buckets.find((b) => b.ym === ym);
      if (bucket) bucket.total += Number(p.amount);
    });
    // "expected" is drawn at the CURRENT monthly rent roll across all months.
    // We don't store historical rent-roll snapshots, so this is a reference
    // line at today's expected level, not a reconstruction of each past month's
    // actual roll — it shows how collection tracked against the current target.
    return buckets.map((b) => ({ month: b.label, collected: b.total, expected }));
  })();

  const openProperty = (p: Property) => {
    setSelectedProperty({ id: p.id, name: p.name, location: p.location });
    navigate({ to: "/dashboard" });
  };

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  // Agents don't have a portfolio — send them to the property view.
  useEffect(() => {
    if (profileLoaded && isAgent) navigate({ to: "/properties" });
  }, [profileLoaded, isAgent, navigate]);

  if (!profileLoaded || propsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!properties?.length) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
          <LayoutGrid className="h-10 w-10" style={{ color: "#166534" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Add a property to see your portfolio overview here.
        </p>
        <button
          onClick={() => navigate({ to: "/properties" })}
          className="mt-6 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white glow-primary"
          style={{ background: "#166534" }}
        >
          Go to Properties
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Hero header — mirrors the per-property dashboard's hero, but scoped
          to the whole portfolio rather than one property. */}
      <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d2818 0%, #166534 100%)" }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full" style={{ background: "#F59E0B", transform: "translate(30%, -30%)" }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full" style={{ background: "#16A34A", transform: "translate(-30%, 30%)" }} />
        </div>
        <div className="relative">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white/60 text-sm font-medium mb-1">{getGreeting()}, {(fullName || "there").split(" ")[0]}</p>
              <h1 className="font-display text-2xl font-bold text-white">Portfolio Overview</h1>
              <p className="text-white/60 text-sm mt-0.5">All {properties.length} properties · {currentMonthLabel}</p>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "rgba(255,255,255,0.15)" }}>
              <LayoutGrid className="h-6 w-6 text-white" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
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

      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#EDE9FE" }}>
              <Building2 className="h-4 w-4" style={{ color: "#6D28D9" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Total Properties</div>
          <div className="font-display text-lg font-bold text-foreground">{properties.length}</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#EFF6FF" }}>
              <Users className="h-4 w-4" style={{ color: "#2563EB" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Total Tenants</div>
          <div className="font-display text-lg font-bold text-foreground">{totalTenants}</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#DCFCE7" }}>
              <DoorOpen className="h-4 w-4" style={{ color: "#16A34A" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Occupied Units</div>
          <div className="font-display text-lg font-bold text-foreground">{occupiedUnits} <span className="text-sm text-muted-foreground font-normal">/ {totalUnits}</span></div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEE2E2" }}>
              <DoorClosed className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Vacant Units</div>
          <div className="font-display text-lg font-bold" style={{ color: vacantUnits > 0 ? "#DC2626" : "#16A34A" }}>{vacantUnits}</div>
        </div>
      </div>

      {/* Money row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEF9C3" }}>
              <Wallet className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
            <span className="text-xs text-muted-foreground">Total Expected</span>
          </div>
          <div className="font-display text-2xl font-bold text-foreground">{formatKES(expected)}</div>
          <div className="text-xs text-muted-foreground mt-1">Monthly rent roll, all properties</div>
        </div>

        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#DCFCE7" }}>
              <TrendingUp className="h-4 w-4" style={{ color: "#16A34A" }} />
            </div>
            <span className="text-xs text-muted-foreground">Collected This Month</span>
          </div>
          <div className="font-display text-2xl font-bold" style={{ color: "#16A34A" }}>{formatKES(collected)}</div>
          <div className="text-xs text-muted-foreground mt-1">{collectionRate}% of expected</div>
        </div>

        <div className="card-surface p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEE2E2" }}>
              <AlertCircle className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
            <span className="text-xs text-muted-foreground">Total Outstanding</span>
          </div>
          <div className="font-display text-2xl font-bold" style={{ color: outstanding > 0 ? "#DC2626" : "#16A34A" }}>{formatKES(outstanding)}</div>
          <div className="text-xs text-muted-foreground mt-1">Still owed this month</div>
        </div>
      </div>

      {/* Second stat row — portfolio health */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEF3C7" }}>
              <TrendingUp className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#FEF3C7", color: "#92400E" }}>
              {occupancyRate}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Occupancy Rate</div>
          <div className="font-display text-lg font-bold text-foreground">{occupancyRate}%</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#EFF6FF" }}>
              <Wallet className="h-4 w-4" style={{ color: "#2563EB" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Avg Rent / Unit</div>
          <div className="font-display text-lg font-bold text-foreground">{formatKES(avgRentPerUnit)}</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: tenantsInArrears > 0 ? "#FEE2E2" : "#DCFCE7" }}>
              <AlertCircle className="h-4 w-4" style={{ color: tenantsInArrears > 0 ? "#DC2626" : "#16A34A" }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-0.5">Tenants in Arrears</div>
          <div className="font-display text-lg font-bold" style={{ color: tenantsInArrears > 0 ? "#DC2626" : "#16A34A" }}>
            {tenantsInArrears}
          </div>
        </div>
      </div>

      {/* Rent collection trend */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display font-bold text-foreground">Rent Collection Trend</h2>
            <p className="text-xs text-muted-foreground">Last 6 months · all properties</p>
          </div>
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EB" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12, fill: "#6B7280" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
                width={40}
              />
              <Tooltip
                formatter={(v: any, name: any) => [formatKES(Number(v)), name === "collected" ? "Collected" : "Expected"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 13 }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="plainline"
                formatter={(value) => (value === "collected" ? "Collected" : "Expected (current)")}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="expected"
                stroke="#D97706"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="collected"
                stroke="#166534"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#166534" }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-property quick list */}
      <div>
        <h2 className="font-display font-bold text-foreground mb-3">Properties</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => {
            const pTenants = (tenants ?? []).filter((t) => t.property_id === p.id);
            const pExpected = pTenants.reduce((s, t) => s + Number(t.rent_amount), 0);
            const pCollectedPayments = (monthPayments ?? [])
              .filter((mp) => mp.property_id === p.id)
              .reduce((s, mp) => s + Number(mp.amount), 0);
            const pCollectedAdvance = pTenants.reduce((s, t) => {
              if (isCoveredByAdvance(t) && !((paidByTenant[t.id] ?? 0) > 0)) return s + Number(t.rent_amount);
              return s;
            }, 0);
            const pCollected = pCollectedPayments + pCollectedAdvance;
            const pRate = pExpected > 0 ? Math.min(100, Math.round((pCollected / pExpected) * 100)) : 0;
            return (
              <button
                key={p.id}
                onClick={() => openProperty(p)}
                className="card-surface card-hover p-4 text-left"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-display font-bold text-foreground truncate">{p.name}</h3>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2" style={{ background: "#DCFCE7", color: "#166534" }}>
                    {pRate}%
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mb-3">{pTenants.length} {pTenants.length === 1 ? "tenant" : "tenants"}</div>
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-bold text-sm" style={{ color: "#16A34A" }}>{formatKES(pCollected)}</span>
                  <span className="text-xs text-muted-foreground">of {formatKES(pExpected)}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#F5F5F0" }}>
                  <div className="h-full rounded-full" style={{ width: `${pRate}%`, background: "#166534" }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}