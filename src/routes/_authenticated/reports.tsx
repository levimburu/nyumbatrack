import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { data: payments } = useQuery({
    queryKey: ["payments-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("amount, paid_on, method").order("paid_on");
      if (error) throw error;
      return data;
    },
  });

  // Group by month
  const byMonth: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  payments?.forEach((p) => {
    const m = new Date(p.paid_on).toLocaleString("en", { month: "short", year: "2-digit" });
    byMonth[m] = (byMonth[m] ?? 0) + Number(p.amount);
    byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
  });
  const monthData = Object.entries(byMonth).map(([month, total]) => ({ month, total }));
  const total = payments?.reduce((s, p) => s + Number(p.amount), 0) ?? 0;
  const avg = monthData.length ? total / monthData.length : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Insights</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Reports</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total collected" value={formatKES(total)} />
        <Stat label="Monthly average" value={formatKES(avg)} />
        <Stat label="Payments recorded" value={String(payments?.length ?? 0)} />
      </div>

      <div className="card-surface p-5">
        <h2 className="mb-4 font-display text-base font-semibold">Monthly income</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={monthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 95)" />
              <XAxis dataKey="month" stroke="oklch(0.5 0.02 160)" fontSize={12} />
              <YAxis stroke="oklch(0.5 0.02 160)" fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatKES(v)} contentStyle={{ borderRadius: 8, border: "1px solid oklch(0.9 0.015 95)" }} />
              <Bar dataKey="total" fill="oklch(0.32 0.07 165)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-surface p-5">
        <h2 className="mb-4 font-display text-base font-semibold">Collection by method</h2>
        <div className="space-y-3">
          {Object.entries(byMethod).map(([m, amt]) => {
            const pct = total ? (amt / total) * 100 : 0;
            return (
              <div key={m}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium uppercase">{m}</span>
                  <span className="text-muted-foreground">{formatKES(amt)} · {pct.toFixed(0)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {!Object.keys(byMethod).length && <p className="text-sm text-muted-foreground">No payment data yet.</p>}
        </div>
      </div>

      <div className="card-surface p-5">
        <h2 className="mb-2 font-display text-base font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          SMS reminders for upcoming and overdue rent are wired into the data model. Connect an SMS provider
          (e.g. Africa's Talking) and an M-Pesa Daraja gateway to activate automatic reminders and payment confirmations.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}
