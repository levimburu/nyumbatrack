import { createFileRoute } from "@tanstack/react-router";
import { fetchManagedProperties, fetchManagedPropertyIds } from "@/lib/managedProperties";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { TrendingUp, CreditCard, BarChart2, X, ChevronDown, ChevronUp, ChevronRight, Building2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell
} from "recharts";

const ID_CHUNK = 100;
const PAGE_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Reads every row of a query, a page at a time, past the API's 1000-row cap. */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export const Route = createFileRoute("/_authenticated/collections")({
  component: CollectionsPage,
});

interface Property {
  id: string;
  name: string;
}

interface TenantMin {
  id: string;
  property_id: string;
  rent_amount: number;
}

interface PaymentRow {
  tenant_id: string;
  amount: number;
  paid_on: string;
  method: string;
  payment_month: string | null;
}

const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

function CollectionsPage() {
  const [isAgent, setIsAgent] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any).from("profiles").select("role").eq("id", user.id).maybeSingle();
      setIsAgent(data?.role === "agent");
    });
  }, []);

  // Same "properties I can manage" pattern as Financials/Maintenance/Arrears
  // — an agent sees every property across their linked landlords, a
  // landlord sees only their own. This is the whole point of this page:
  // the existing per-property Reports page can only ever show one property
  // at a time, which doesn't answer "how's my whole portfolio doing."
  const { data: properties } = useQuery({
    queryKey: ["collections-properties", isAgent],
    enabled: isAgent !== null,
    queryFn: async () => {
      return (await fetchManagedProperties("id, name", { column: "name", ascending: true })) as Property[];
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);
  const safePropertyIds = propertyIds.length ? propertyIds : [PLACEHOLDER_ID];

  const { data: tenants, error: tenantsError } = useQuery({
    queryKey: ["collections-tenants", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const rows: TenantMin[] = [];
      for (const ids of chunk(safePropertyIds, ID_CHUNK)) {
        rows.push(...(await fetchAllPages<TenantMin>((from, to) =>
          (supabase as any).from("tenants").select("id, property_id, rent_amount")
            .in("property_id", ids).order("id").range(from, to))));
      }
      return rows;
    },
  });

  const tenantIds = (tenants ?? []).map((t) => t.id);
  const safeTenantIds = tenantIds.length ? tenantIds : [PLACEHOLDER_ID];

  const { data: payments, error: paymentsError } = useQuery({
    queryKey: ["collections-payments", tenantIds.join(",")],
    enabled: tenantIds.length > 0,
    queryFn: async () => {
      // Tenant IDs go in batches: one request with hundreds of IDs makes the
      // URL too long and the API rejects it with "Bad Request".
      const rows: PaymentRow[] = [];
      for (const ids of chunk(safeTenantIds, ID_CHUNK)) {
        rows.push(...(await fetchAllPages<PaymentRow>((from, to) =>
          (supabase as any).from("payments").select("tenant_id, amount, paid_on, method, payment_month")
            .in("tenant_id", ids).order("paid_on").order("id").range(from, to))));
      }
      return rows;
    },
  });

  const tenantToProperty: Record<string, string> = {};
  (tenants ?? []).forEach((t) => { tenantToProperty[t.id] = t.property_id; });

  const byMonth: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  (payments ?? []).forEach((p) => {
    let label: string;
    if (p.payment_month) {
      const d = new Date(p.payment_month);
      label = isNaN(d.getTime())
        ? new Date(p.paid_on).toLocaleString("en", { month: "short", year: "2-digit" })
        : d.toLocaleString("en", { month: "short", year: "2-digit" });
    } else {
      label = new Date(p.paid_on).toLocaleString("en", { month: "short", year: "2-digit" });
    }
    byMonth[label] = (byMonth[label] ?? 0) + Number(p.amount);
    byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
  });

  const expectedPerMonth = (tenants ?? []).reduce((s, t) => s + Number(t.rent_amount), 0);
  const collectedByPaymentMonth: Record<string, number> = {};
  (payments ?? []).forEach((p) => {
    const key = p.payment_month ?? "Unknown";
    collectedByPaymentMonth[key] = (collectedByPaymentMonth[key] ?? 0) + Number(p.amount);
  });
  const monthHistory = Object.entries(collectedByPaymentMonth)
    .filter(([month]) => month !== "Unknown")
    .map(([month, collected]) => {
      const outstanding = Math.max(0, expectedPerMonth - collected);
      const rate = expectedPerMonth > 0 ? Math.min(100, Math.round((collected / expectedPerMonth) * 100)) : 0;
      return { month, collected, expected: expectedPerMonth, outstanding, rate, ts: new Date(month).getTime() };
    })
    .sort((a, b) => b.ts - a.ts);

  const now = new Date();
  const currentMonthKey = now.toLocaleString("en", { month: "short", year: "2-digit" });
  const monthData = Object.entries(byMonth).map(([month, total]) => ({
    month,
    total,
    isCurrent: month === currentMonthKey,
  }));

  const total = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const avg = monthData.length ? Math.round(total / monthData.length) : 0;

  const [showTotalBreakdown, setShowTotalBreakdown] = useState(false);
  const [openBreakdownYear, setOpenBreakdownYear] = useState<number | null>(null);

  const collectedByYear: Record<number, { total: number; months: Record<string, number> }> = {};
  (payments ?? []).forEach((p) => {
    const label = p.payment_month || null;
    const d = label ? new Date(label) : new Date(p.paid_on);
    const year = isNaN(d.getTime()) ? new Date(p.paid_on).getFullYear() : d.getFullYear();
    const monthLabel = label ?? new Date(p.paid_on).toLocaleString("en", { month: "long", year: "numeric" });
    if (!collectedByYear[year]) collectedByYear[year] = { total: 0, months: {} };
    collectedByYear[year].total += Number(p.amount);
    collectedByYear[year].months[monthLabel] = (collectedByYear[year].months[monthLabel] ?? 0) + Number(p.amount);
  });
  const breakdownYears = Object.keys(collectedByYear).map(Number).sort((a, b) => b - a);

  const currentYear = now.getFullYear();
  const yearHistory = breakdownYears.map((year) => {
    const collected = collectedByYear[year].total;
    const monthsInYear = year === currentYear ? now.getMonth() + 1 : 12;
    const expected = expectedPerMonth * monthsInYear;
    const outstanding = Math.max(0, expected - collected);
    const rate = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
    return { year, collected, expected, outstanding, rate };
  });

  // Unique to the portfolio view — a per-property line, since the whole
  // point of this page over the existing per-property Reports page is
  // seeing every property at once without losing which is which.
  const collectedByProperty: Record<string, number> = {};
  (payments ?? []).forEach((p) => {
    const pid = tenantToProperty[p.tenant_id];
    if (!pid) return;
    collectedByProperty[pid] = (collectedByProperty[pid] ?? 0) + Number(p.amount);
  });
  const expectedByProperty: Record<string, number> = {};
  (tenants ?? []).forEach((t) => {
    expectedByProperty[t.property_id] = (expectedByProperty[t.property_id] ?? 0) + Number(t.rent_amount);
  });
  const monthsElapsed = (() => {
    const allDates = (payments ?? []).map((p) => new Date(p.payment_month || p.paid_on).getTime()).filter((t) => !isNaN(t));
    if (!allDates.length) return 1;
    const earliest = new Date(Math.min(...allDates));
    const months = (now.getFullYear() - earliest.getFullYear()) * 12 + (now.getMonth() - earliest.getMonth()) + 1;
    return Math.max(1, months);
  })();
  const propertyRows = (properties ?? []).map((p) => {
    const collected = collectedByProperty[p.id] ?? 0;
    const expected = (expectedByProperty[p.id] ?? 0) * monthsElapsed;
    const rate = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
    return { property: p, collected, rate };
  }).sort((a, b) => b.collected - a.collected);

  const methodLabels: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank Transfer", cash: "Cash" };
  const methodColors: Record<string, string> = { mpesa: "var(--k-166534)", bank: "var(--k-2563EB)", cash: "var(--k-6B7280)" };

  if (properties && properties.length === 0) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "var(--k-DCFCE7)" }}>
          <TrendingUp className="h-10 w-10" style={{ color: "var(--kt-166534)" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">Add a property first to see collection reports.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Rent Collection Report</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Summarized across all {properties?.length ?? 0} {properties?.length === 1 ? "property" : "properties"} you manage
        </p>
      </div>

      {(tenantsError || paymentsError) && (
        <div className="card-surface p-4 border-l-4" style={{ borderLeftColor: "var(--k-DC2626)", background: "var(--k-FEF2F2)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--kt-991B1B)" }}>Couldn't load some data for this report</p>
          {tenantsError && (
            <p className="text-xs mt-1" style={{ color: "var(--kt-991B1B)" }}>Tenants: {(tenantsError as any)?.message ?? String(tenantsError)}</p>
          )}
          {paymentsError && (
            <p className="text-xs mt-1" style={{ color: "var(--kt-991B1B)" }}>Payments: {(paymentsError as any)?.message ?? String(paymentsError)}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <button onClick={() => setShowTotalBreakdown(true)} className="card-surface p-5 text-left hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "var(--k-DCFCE7)" }}>
              <TrendingUp className="h-5 w-5" style={{ color: "var(--kt-16A34A)" }} />
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Total Collected (All Time)</div>
          <div className="font-display text-xl font-bold text-foreground">{formatKES(total)}</div>
        </button>
        <div className="card-surface p-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl mb-3" style={{ background: "var(--k-EFF6FF)" }}>
            <CreditCard className="h-5 w-5" style={{ color: "var(--kt-2563EB)" }} />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Monthly Average</div>
          <div className="font-display text-xl font-bold text-foreground">{formatKES(avg)}</div>
        </div>
        <div className="card-surface p-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl mb-3" style={{ background: "var(--k-F5F0FF)" }}>
            <BarChart2 className="h-5 w-5" style={{ color: "var(--kt-7C3AED)" }} />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Payments Recorded</div>
          <div className="font-display text-xl font-bold text-foreground">{payments?.length ?? 0}</div>
        </div>
      </div>

      {/* Per-property breakdown — the piece that doesn't exist anywhere else */}
      <div className="card-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display text-base font-semibold">By Property</h2>
          <p className="text-xs text-muted-foreground mt-0.5">All-time collected and collection rate per property</p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: "480px", fontSize: "0.875rem", borderCollapse: "collapse" }}>
            <thead>
              <tr className="border-b border-border" style={{ background: "var(--k-F9FAFB)" }}>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Property</th>
                <th className="py-3 text-left text-xs font-medium text-muted-foreground">Collected</th>
                <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Rate</th>
              </tr>
            </thead>
            <tbody>
              {propertyRows.map((r) => (
                <tr key={r.property.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 font-medium text-foreground">
                    <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {r.property.name}</span>
                  </td>
                  <td className="py-3 font-semibold" style={{ color: "var(--kt-16A34A)" }}>{formatKES(r.collected)}</td>
                  <td className="py-3 pr-5 text-right">
                    <span
                      className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{
                        background: r.rate >= 90 ? "var(--k-DCFCE7)" : r.rate >= 50 ? "var(--k-FEF9C3)" : "var(--k-FEE2E2)",
                        color: r.rate >= 90 ? "var(--kt-166534)" : r.rate >= 50 ? "var(--kt-854D0E)" : "var(--kt-991B1B)",
                      }}
                    >
                      {r.rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-base font-semibold">Monthly Rent Collected</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--k-166534)" }} /> Collected</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--k-F59E0B)" }} /> Current month</span>
          </div>
        </div>
        {monthData.length > 0 && (
          <p className="text-xs text-muted-foreground mb-4">{monthData[0]?.month} – {monthData[monthData.length - 1]?.month}</p>
        )}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--kt-F0F0EB)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--kt-6B7280)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--kt-6B7280)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatKES(v)} contentStyle={{ borderRadius: 8, border: "1px solid var(--k-E5E7EB)", fontSize: 12 }} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {monthData.map((entry, index) => (
                  <Cell key={index} fill={entry.isCurrent ? "var(--kt-F59E0B)" : "var(--kt-166534)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {monthData.some((m) => m.isCurrent) && (
          <p className="text-xs text-muted-foreground text-right mt-2">* {currentMonthKey} is a partial month</p>
        )}
      </div>

      <div className="card-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display text-base font-semibold">Monthly Collection History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Collected per rent month across your portfolio, including advance payments</p>
        </div>
        {monthHistory.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No payment history yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "560px", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-border" style={{ background: "var(--k-F9FAFB)" }}>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Month</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Collected</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Expected</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Outstanding</th>
                  <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Rate</th>
                </tr>
              </thead>
              <tbody>
                {monthHistory.map((row) => (
                  <tr key={row.month} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">{row.month}</td>
                    <td className="py-3 font-semibold" style={{ color: "var(--kt-16A34A)" }}>{formatKES(row.collected)}</td>
                    <td className="py-3 text-muted-foreground">{formatKES(row.expected)}</td>
                    <td className="py-3 font-medium" style={{ color: row.outstanding > 0 ? "var(--kt-DC2626)" : "var(--kt-6B7280)" }}>
                      {row.outstanding > 0 ? formatKES(row.outstanding) : "—"}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <span
                        className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: row.rate >= 90 ? "var(--k-DCFCE7)" : row.rate >= 50 ? "var(--k-FEF9C3)" : "var(--k-FEE2E2)",
                          color: row.rate >= 90 ? "var(--kt-166534)" : row.rate >= 50 ? "var(--kt-854D0E)" : "var(--kt-991B1B)",
                        }}
                      >
                        {row.rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display text-base font-semibold">Yearly Collection History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Collected per year across your portfolio, including advance payments</p>
        </div>
        {yearHistory.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No payment history yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "560px", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-border" style={{ background: "var(--k-F9FAFB)" }}>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Year</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Collected</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Expected</th>
                  <th className="py-3 text-left text-xs font-medium text-muted-foreground">Outstanding</th>
                  <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Rate</th>
                </tr>
              </thead>
              <tbody>
                {yearHistory.map((row) => (
                  <tr key={row.year} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">{row.year}</td>
                    <td className="py-3 font-semibold" style={{ color: "var(--kt-16A34A)" }}>{formatKES(row.collected)}</td>
                    <td className="py-3 text-muted-foreground">{formatKES(row.expected)}</td>
                    <td className="py-3 font-medium" style={{ color: row.outstanding > 0 ? "var(--kt-DC2626)" : "var(--kt-6B7280)" }}>
                      {row.outstanding > 0 ? formatKES(row.outstanding) : "—"}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <span
                        className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: row.rate >= 90 ? "var(--k-DCFCE7)" : row.rate >= 50 ? "var(--k-FEF9C3)" : "var(--k-FEE2E2)",
                          color: row.rate >= 90 ? "var(--kt-166534)" : row.rate >= 50 ? "var(--kt-854D0E)" : "var(--kt-991B1B)",
                        }}
                      >
                        {row.rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-surface p-5">
        <h2 className="font-display text-base font-semibold mb-4">Payment Methods Breakdown</h2>
        {Object.keys(byMethod).length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment data yet across your portfolio.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(byMethod).map(([m, amt]) => {
              const pct = total ? Math.round((amt / total) * 100) : 0;
              const color = methodColors[m] ?? "var(--kt-6B7280)";
              const label = methodLabels[m] ?? m;
              return (
                <div key={m}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: m === "mpesa" ? "var(--k-DCFCE7)" : m === "bank" ? "var(--k-EFF6FF)" : "var(--k-F5F5F0)", color }}
                      >
                        {label}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground">{pct}%</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{formatKES(amt)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showTotalBreakdown && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTotalBreakdown(false)} />
          <div className="relative w-full max-w-md h-full bg-card flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4" style={{ background: "var(--k-166534)" }}>
              <div>
                <h2 className="font-display text-lg font-bold text-white">Total Collected (All Time)</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>Across your portfolio · {formatKES(total)}</p>
              </div>
              <button onClick={() => setShowTotalBreakdown(false)} className="text-white/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {breakdownYears.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl mb-4" style={{ background: "var(--k-F5F5F0)" }}>
                    <TrendingUp className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-foreground mb-1">No payments yet</p>
                  <p className="text-sm text-muted-foreground">Collected amounts will appear here once payments are recorded.</p>
                </div>
              ) : (
                <div className="px-5 py-4 space-y-3">
                  {breakdownYears.map((year) => {
                    const yearData = collectedByYear[year];
                    const isOpen = openBreakdownYear === year;
                    const monthEntries = Object.entries(yearData.months).sort((a, b) => {
                      const da = new Date(a[0]).getTime();
                      const db = new Date(b[0]).getTime();
                      return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
                    });
                    return (
                      <div key={year} className="rounded-xl border border-border overflow-hidden">
                        <button type="button" onClick={() => setOpenBreakdownYear(isOpen ? null : year)} className="w-full flex items-center justify-between px-4 py-3" style={{ background: "var(--k-F9FAFB)" }}>
                          <span className="text-sm font-semibold text-foreground">{year}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-bold text-sm" style={{ color: "var(--kt-16A34A)" }}>{formatKES(yearData.total)}</span>
                            {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="divide-y divide-border">
                            {monthEntries.map(([month, amount]) => (
                              <div key={month} className="flex items-center justify-between px-4 py-2.5">
                                <span className="text-sm text-foreground">{month}</span>
                                <span className="text-sm font-semibold" style={{ color: "var(--kt-16A34A)" }}>{formatKES(amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}