import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { TrendingUp, CreditCard, BarChart2 } from "lucide-react";
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
        <div className="card-surface p-5">
          <div
            className="grid h-10 w-10 place-items-center rounded-xl mb-3"
            style={{ background: "#DCFCE7" }}
          >
            <TrendingUp className="h-5 w-5" style={{ color: "#16A34A" }} />
          </div>
          <div className="text-xs text-muted-foreground mb-1">Total Collected (YTD)</div>
          <div className="font-display text-xl font-bold text-foreground">{formatKES(total)}</div>
        </div>
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
    </div>
  );
}