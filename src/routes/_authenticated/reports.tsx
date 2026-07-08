import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { TrendingUp, CreditCard, BarChart2, X, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell
} from "recharts";
import { useProperty } from "@/context/PropertyContext";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { selectedProperty } = useProperty();
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedProperty) navigate({ to: "/properties" });
  }, [selectedProperty, navigate]);

  const { data: payments } = useQuery({
    queryKey: ["payments-all", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("amount, paid_on, method, payment_month, tenants(property_id)")
        .order("paid_on");
      if (error) throw error;
      const all = data as any[];
      return all.filter((p) => p.tenants?.property_id === selectedProperty!.id);
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants-rent", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("rent_amount")
        .eq("property_id", selectedProperty!.id);
      if (error) throw error;
      return data as { rent_amount: number }[];
    },
  });

  const byMonth: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  payments?.forEach((p) => {
    // Chart by the month the rent is FOR (payment_month), so a top-up paid
    // in a later month still counts toward the month it was meant for —
    // consistent with the Monthly Collection History below.
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

  // Monthly history grouped by payment_month (the month rent is FOR)
  const expectedPerMonth = (tenants ?? []).reduce((s, t) => s + Number(t.rent_amount), 0);
  const collectedByPaymentMonth: Record<string, number> = {};
  payments?.forEach((p) => {
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

  const total = payments?.reduce((s, p) => s + Number(p.amount), 0) ?? 0;
  const avg = monthData.length ? Math.round(total / monthData.length) : 0;

  // Group all-time collected by year, then by month within each year — used
  // by the tappable "Total Collected" breakdown. Grouped by payment_month
  // (the month rent is FOR) so it lines up with the rest of the app; falls
  // back to paid_on if payment_month is missing.
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
  const breakdownYears = Object.keys(collectedByYear)
    .map(Number)
    .sort((a, b) => b - a);

  // Yearly Collection History: same idea as the monthly table below, but
  // rolled up per year. Expected assumes 12 months for a completed year, and
  // only Jan-through-now for the current year (so it isn't inflated by
  // months that haven't happened yet).
  const currentYear = now.getFullYear();
  const yearHistory = breakdownYears.map((year) => {
    const collected = collectedByYear[year].total;
    const monthsInYear = year === currentYear ? now.getMonth() + 1 : 12;
    const expected = expectedPerMonth * monthsInYear;
    const outstanding = Math.max(0, expected - collected);
    const rate = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
    return { year, collected, expected, outstanding, rate };
  });

  const methodLabels: Record<string, string> = {
    mpesa: "M-Pesa",
    bank: "Bank Transfer",
    cash: "Cash",
  };
  const methodColors: Record<string, string> = {
    mpesa: "#166534",
    bank: "#2563EB",
    cash: "#6B7280",
  };

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {selectedProperty.name} · Financial overview
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <button
          onClick={() => setShowTotalBreakdown(true)}
          className="card-surface p-5 text-left hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: "#DCFCE7" }}
            >
              <TrendingUp className="h-5 w-5" style={{ color: "#16A34A" }} />
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Total Collected (All Time)</div>
          <div className="font-display text-xl font-bold text-foreground">{formatKES(total)}</div>
        </button>
        <div className="card-surface p-5">
          <div
            className="grid h-10 w-10 place-items-center rounded-xl mb-3"
            style={{ background: "#EFF6FF" }}
          >
            <CreditCard className="h-5 w-5" style={{ color: "#2563EB" }} />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Monthly Average</div>
          <div className="font-display text-xl font-bold text-foreground">{formatKES(avg)}</div>
        </div>
        <div className="card-surface p-5">
          <div
            className="grid h-10 w-10 place-items-center rounded-xl mb-3"
            style={{ background: "#F5F0FF" }}
          >
            <BarChart2 className="h-5 w-5" style={{ color: "#7C3AED" }} />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Payments Recorded</div>
          <div className="font-display text-xl font-bold text-foreground">{payments?.length ?? 0}</div>
        </div>
      </div>

      {/* Monthly chart */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-base font-semibold">Monthly Rent Collected</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#166534" }} />
              Collected
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#F59E0B" }} />
              Current month
            </span>
          </div>
        </div>
        {monthData.length > 0 && (
          <p className="text-xs text-muted-foreground mb-4">
            {monthData[0]?.month} – {monthData[monthData.length - 1]?.month}
          </p>
        )}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EB" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip
                formatter={(v: number) => formatKES(v)}
                contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
              />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {monthData.map((entry, index) => (
                  <Cell key={index} fill={entry.isCurrent ? "#F59E0B" : "#166534"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {monthData.some((m) => m.isCurrent) && (
          <p className="text-xs text-muted-foreground text-right mt-2">
            * {currentMonthKey} is a partial month
          </p>
        )}
      </div>

      {/* Monthly collection history (by rent month) */}
      <div className="card-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display text-base font-semibold">Monthly Collection History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Collected per rent month, including advance payments</p>
        </div>
        {monthHistory.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No payment history yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "560px", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-border" style={{ background: "#F9FAFB" }}>
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
                    <td className="py-3 font-semibold" style={{ color: "#16A34A" }}>{formatKES(row.collected)}</td>
                    <td className="py-3 text-muted-foreground">{formatKES(row.expected)}</td>
                    <td className="py-3 font-medium" style={{ color: row.outstanding > 0 ? "#DC2626" : "#6B7280" }}>
                      {row.outstanding > 0 ? formatKES(row.outstanding) : "—"}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <span
                        className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: row.rate >= 90 ? "#DCFCE7" : row.rate >= 50 ? "#FEF9C3" : "#FEE2E2",
                          color: row.rate >= 90 ? "#166534" : row.rate >= 50 ? "#854D0E" : "#991B1B",
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

      {/* Yearly collection history (by rent year) */}
      <div className="card-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-display text-base font-semibold">Yearly Collection History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Collected per year, including advance payments</p>
        </div>
        {yearHistory.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No payment history yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "560px", fontSize: "0.875rem", borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-border" style={{ background: "#F9FAFB" }}>
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
                    <td className="py-3 font-semibold" style={{ color: "#16A34A" }}>{formatKES(row.collected)}</td>
                    <td className="py-3 text-muted-foreground">{formatKES(row.expected)}</td>
                    <td className="py-3 font-medium" style={{ color: row.outstanding > 0 ? "#DC2626" : "#6B7280" }}>
                      {row.outstanding > 0 ? formatKES(row.outstanding) : "—"}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <span
                        className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: row.rate >= 90 ? "#DCFCE7" : row.rate >= 50 ? "#FEF9C3" : "#FEE2E2",
                          color: row.rate >= 90 ? "#166534" : row.rate >= 50 ? "#854D0E" : "#991B1B",
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

      {/* Payment methods breakdown */}
      <div className="card-surface p-5">
        <h2 className="font-display text-base font-semibold mb-4">Payment Methods Breakdown</h2>
        {Object.keys(byMethod).length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment data yet for {selectedProperty.name}.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(byMethod).map(([m, amt]) => {
              const pct = total ? Math.round((amt / total) * 100) : 0;
              const color = methodColors[m] ?? "#6B7280";
              const label = methodLabels[m] ?? m;
              return (
                <div key={m}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          background: m === "mpesa" ? "#DCFCE7" : m === "bank" ? "#EFF6FF" : "#F5F5F0",
                          color,
                        }}
                      >
                        {label}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground">{pct}%</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{formatKES(amt)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Total Collected (All Time) breakdown — by year, expandable to months */}
      {showTotalBreakdown && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTotalBreakdown(false)} />
          <div className="relative w-full max-w-md h-full bg-white flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4" style={{ background: "#166534" }}>
              <div>
                <h2 className="font-display text-lg font-bold text-white">Total Collected (All Time)</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {selectedProperty?.name} · {formatKES(total)}
                </p>
              </div>
              <button onClick={() => setShowTotalBreakdown(false)} className="text-white/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {breakdownYears.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl mb-4" style={{ background: "#F5F5F0" }}>
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
                        <button
                          type="button"
                          onClick={() => setOpenBreakdownYear(isOpen ? null : year)}
                          className="w-full flex items-center justify-between px-4 py-3"
                          style={{ background: "#F9FAFB" }}
                        >
                          <span className="text-sm font-semibold text-foreground">{year}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-bold text-sm" style={{ color: "#16A34A" }}>
                              {formatKES(yearData.total)}
                            </span>
                            {isOpen ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="divide-y divide-border">
                            {monthEntries.map(([month, amount]) => (
                              <div key={month} className="flex items-center justify-between px-4 py-2.5">
                                <span className="text-sm text-foreground">{month}</span>
                                <span className="text-sm font-semibold" style={{ color: "#16A34A" }}>{formatKES(amount)}</span>
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