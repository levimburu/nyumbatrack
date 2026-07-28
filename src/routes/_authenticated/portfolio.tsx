import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { useProperty } from "@/context/PropertyContext";
import {
  Building2, Users, Wallet, TrendingUp, AlertCircle, DoorOpen, DoorClosed, LayoutGrid,
  Wrench, CheckCircle2, Clock, Circle,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, ComposedChart, Area,
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

  // Maintenance tickets across the whole portfolio, for the tickets donut.
  const { data: tickets } = useQuery({
    queryKey: ["portfolio-tickets", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_tickets")
        .select("id, title, status, created_at, property_id")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; title: string; status: string; created_at: string; property_id: string }[];
    },
  });

  // Compliance records across the whole portfolio, for the compliance donut.
  const { data: complianceRecords } = useQuery({
    queryKey: ["portfolio-compliance", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compliance_records")
        .select("id, expiry_date")
        .in("property_id", propertyIds);
      if (error) throw error;
      return data as { id: string; expiry_date: string }[];
    },
  });

  // Recent payments with tenant detail, for the activity feed — separate
  // from monthPayments above since that one only needs totals.
  const { data: recentPayments } = useQuery({
    queryKey: ["portfolio-recent-payments", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("id, amount, paid_on, tenants(full_name, unit, property_id)")
        .order("paid_on", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as any[]).filter((p) => propertyIds.includes(p.tenants?.property_id));
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

  // Split the outstanding total into "overdue" (past the due date — the
  // urgent portion) vs "pending" (owed but not yet late), so the Rent
  // Collection card can show all three the way a real statement would.
  const overdueAmount = (tenants ?? []).reduce((s, t) => {
    const alreadyPaid = (paidByTenant[t.id] ?? 0) > 0 || isCoveredByAdvance(t);
    if (!alreadyPaid && t.next_due_date && t.next_due_date <= todayStr) return s + Number(t.rent_amount);
    return s;
  }, 0);
  const pendingAmount = Math.max(0, outstanding - overdueAmount);

  // Maintenance ticket status breakdown, for the donut.
  const openTickets = (tickets ?? []).filter((t) => t.status === "open").length;
  const inProgressTickets = (tickets ?? []).filter((t) => t.status === "in_progress").length;
  const doneTickets = (tickets ?? []).filter((t) => t.status === "done").length;
  const totalTickets = (tickets ?? []).length;

  // Compliance status breakdown — same Valid/Expiring Soon/Expired logic as
  // the Compliance page itself, just aggregated into one glance-able ring
  // here rather than a per-record list.
  const complianceStatus = (expiryDate: string): "valid" | "expiring_soon" | "expired" => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    const diffDays = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "expired";
    if (diffDays <= 30) return "expiring_soon";
    return "valid";
  };
  const validCompliance = (complianceRecords ?? []).filter((c) => complianceStatus(c.expiry_date) === "valid").length;
  const expiringCompliance = (complianceRecords ?? []).filter((c) => complianceStatus(c.expiry_date) === "expiring_soon").length;
  const expiredCompliance = (complianceRecords ?? []).filter((c) => complianceStatus(c.expiry_date) === "expired").length;
  const totalCompliance = (complianceRecords ?? []).length;
  const compliancePercent = totalCompliance > 0 ? Math.round((validCompliance / totalCompliance) * 100) : 0;

  // Recent activity — payments and maintenance tickets merged into one feed,
  // newest first. Payments only carry date-level precision (paid_on), while
  // tickets have real timestamps, so each renders its own honest format
  // rather than faking "x minutes ago" for a payment recorded by date alone.
  function timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  function formatShortDate(d: string): string {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  }
  type ActivityIcon = "payment" | "ticket" | "done";
  const activityFeed = [
    ...(recentPayments ?? []).map((p: any) => ({
      key: `pay-${p.id}`,
      icon: "payment" as ActivityIcon,
      title: `Rent received from ${p.tenants?.full_name ?? "a tenant"}`,
      detail: `${formatKES(p.amount)} · Unit ${p.tenants?.unit ?? "—"}`,
      when: formatShortDate(p.paid_on),
      sortTime: new Date(p.paid_on).getTime(),
    })),
    ...(tickets ?? []).slice(0, 10).map((t) => ({
      key: `ticket-${t.id}`,
      icon: (t.status === "done" ? "done" : "ticket") as ActivityIcon,
      title: t.status === "done" ? `Maintenance ticket completed` : `Maintenance ticket logged`,
      detail: t.title,
      when: timeAgo(t.created_at),
      sortTime: new Date(t.created_at).getTime(),
    })),
  ]
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 6);

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

      {/* Rent Collection · Maintenance · Compliance — the three things a
          property manager actually checks daily, side by side. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Rent Collection */}
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-bold text-foreground">Rent Collection</h3>
            <span className="text-xs text-muted-foreground">This Month</span>
          </div>
          <div className="font-display text-2xl font-bold" style={{ color: "#16A34A" }}>{formatKES(collected)}</div>
          <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: "#F5F5F0" }}>
            <div className="h-full rounded-full" style={{ width: `${collectionRate}%`, background: "#16A34A" }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
            <span>Collected {formatKES(collected)} ({collectionRate}%)</span>
            <span>Target {formatKES(expected)}</span>
          </div>
          <div className="mt-4 space-y-2 pt-3" style={{ borderTop: "1px solid #F0F0EB" }}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-semibold" style={{ color: "#16A34A" }}>{formatKES(collected)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Pending</span>
              <span className="font-semibold" style={{ color: "#D97706" }}>{formatKES(pendingAmount)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Overdue</span>
              <span className="font-semibold" style={{ color: "#DC2626" }}>{formatKES(overdueAmount)}</span>
            </div>
          </div>
        </div>

        {/* Maintenance Tickets donut */}
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-bold text-foreground">Maintenance Tickets</h3>
            <span className="text-xs text-muted-foreground">All Time</span>
          </div>
          {totalTickets === 0 ? (
            <p className="text-sm text-muted-foreground mt-6 mb-6 text-center">No tickets logged yet.</p>
          ) : (
            <div className="relative" style={{ height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Open", value: openTickets },
                      { name: "In Progress", value: inProgressTickets },
                      { name: "Completed", value: doneTickets },
                    ]}
                    dataKey="value"
                    innerRadius={42}
                    outerRadius={62}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    <Cell fill="#DC2626" />
                    <Cell fill="#D97706" />
                    <Cell fill="#16A34A" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="font-display text-xl font-bold text-foreground">{totalTickets}</div>
                <div className="text-[10px] text-muted-foreground">Total Tickets</div>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Circle className="h-2.5 w-2.5" fill="#DC2626" stroke="none" /> Open</span>
              <span className="font-medium text-foreground">{openTickets}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-2.5 w-2.5" style={{ color: "#D97706" }} /> In Progress</span>
              <span className="font-medium text-foreground">{inProgressTickets}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="h-2.5 w-2.5" style={{ color: "#16A34A" }} /> Completed</span>
              <span className="font-medium text-foreground">{doneTickets}</span>
            </div>
          </div>
          <a href="/maintenance" className="mt-4 block w-full rounded-xl border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-muted transition-colors">
            View All Tickets
          </a>
        </div>

        {/* Compliance Status donut */}
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-bold text-foreground">Compliance Status</h3>
            <span className="text-xs text-muted-foreground">All Properties</span>
          </div>
          {totalCompliance === 0 ? (
            <p className="text-sm text-muted-foreground mt-6 mb-6 text-center">No compliance records yet.</p>
          ) : (
            <div className="relative" style={{ height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: "Valid", value: validCompliance },
                      { name: "Needs Attention", value: expiringCompliance + expiredCompliance },
                    ]}
                    dataKey="value"
                    innerRadius={42}
                    outerRadius={62}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    <Cell fill="#16A34A" />
                    <Cell fill="#E5E7EB" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="font-display text-xl font-bold" style={{ color: "#16A34A" }}>{compliancePercent}%</div>
                <div className="text-[10px] text-muted-foreground">Compliant</div>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="h-2.5 w-2.5" style={{ color: "#16A34A" }} /> Valid</span>
              <span className="font-medium text-foreground">{validCompliance}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-2.5 w-2.5" style={{ color: "#D97706" }} /> Expiring Soon</span>
              <span className="font-medium text-foreground">{expiringCompliance}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><AlertCircle className="h-2.5 w-2.5" style={{ color: "#DC2626" }} /> Expired</span>
              <span className="font-medium text-foreground">{expiredCompliance}</span>
            </div>
          </div>
          <a href="/compliance" className="mt-4 block w-full rounded-xl border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-muted transition-colors">
            View Compliance
          </a>
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
            <ComposedChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#166534" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#166534" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <Area
                type="monotone"
                dataKey="collected"
                stroke="#166534"
                strokeWidth={2.5}
                fill="url(#collectedFill)"
                dot={{ r: 4, fill: "#166534" }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity — payments and maintenance tickets merged, newest
          first. Pulls from data you've actually logged, not a live feed. */}
      <div className="card-surface p-5">
        <h2 className="font-display font-bold text-foreground mb-4">Recent Activity</h2>
        {activityFeed.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nothing logged yet.</p>
        ) : (
          <div className="space-y-3">
            {activityFeed.map((a) => (
              <div key={a.key} className="flex items-start gap-3">
                <div
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full"
                  style={{
                    background: a.icon === "done" ? "#DCFCE7" : a.icon === "ticket" ? "#FEF3C7" : "#DCFCE7",
                  }}
                >
                  {a.icon === "payment" && <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />}
                  {a.icon === "ticket" && <Wrench className="h-4 w-4" style={{ color: "#D97706" }} />}
                  {a.icon === "done" && <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{a.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.detail}</div>
                </div>
                <div className="text-xs text-muted-foreground flex-shrink-0">{a.when}</div>
              </div>
            ))}
          </div>
        )}
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