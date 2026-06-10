import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/StatCard";
import { Users, Wallet, TrendingUp, AlertCircle } from "lucide-react";
import { formatKES, formatDate } from "@/lib/format";
import { useProperty } from "@/context/PropertyContext";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { selectedProperty } = useProperty();
  const navigate = useNavigate();

  useEffect(() => {
    if (!selectedProperty) {
      navigate({ to: "/properties" });
    }
  }, [selectedProperty, navigate]);

  const { data: tenants } = useQuery({
    queryKey: ["tenants", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from("payments")
        .select("*, tenants(full_name, unit, property_id)")
        .eq("tenants.property_id", selectedProperty!.id)
        .order("paid_on", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const totalTenants = tenants?.length ?? 0;
  const expected = tenants?.reduce((s, t) => s + Number(t.rent_amount), 0) ?? 0;
  const outstanding = tenants?.reduce((s, t) => s + Number(t.balance), 0) ?? 0;
  const collected = expected - outstanding;
  const collectionRate = expected ? Math.round((collected / expected) * 100) : 0;

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {selectedProperty.name}
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {collectionRate}% of this month's rent collected.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total tenants" value={String(totalTenants)} icon={Users} />
        <StatCard label="Expected rent" value={formatKES(expected)} icon={Wallet} tone="gold" hint="This month" />
        <StatCard label="Collected" value={formatKES(collected)} icon={TrendingUp} tone="success" />
        <StatCard label="Outstanding" value={formatKES(outstanding)} icon={AlertCircle} tone="warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card-surface lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-base font-semibold">Tenants</h2>
            <span className="text-xs text-muted-foreground">Live</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th>Unit</th>
                  <th>Rent</th>
                  <th>Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants?.map((t) => {
                  const status = Number(t.balance) === 0 ? "paid" : Number(t.balance) < Number(t.rent_amount) ? "partial" : "unpaid";
                  return (
                    <tr key={t.id} className="border-t border-border/60">
                      <td className="px-5 py-3 font-medium">{t.full_name}</td>
                      <td className="text-muted-foreground">{t.unit}</td>
                      <td>{formatKES(t.rent_amount)}</td>
                      <td className={Number(t.balance) > 0 ? "text-foreground font-medium" : "text-muted-foreground"}>
                        {formatKES(t.balance)}
                      </td>
                      <td><StatusPill status={status} /></td>
                    </tr>
                  );
                })}
                {!tenants?.length && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      No tenants yet for this property.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card-surface">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-display text-base font-semibold">Recent payments</h2>
          </div>
          <ul className="divide-y divide-border">
            {payments?.length ? payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm font-medium">{p.tenants?.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.tenants?.unit} · {formatDate(p.paid_on)} · {p.method.toUpperCase()}
                  </div>
                </div>
                <div className="font-display text-sm font-semibold text-success">
                  +{formatKES(p.amount)}
                </div>
              </li>
            )) : (
              <li className="px-5 py-6 text-sm text-muted-foreground">No payments yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: "paid" | "partial" | "unpaid" }) {
  const m = {
    paid: "bg-success/15 text-success",
    partial: "bg-warning/25 text-warning-foreground",
    unpaid: "bg-destructive/15 text-destructive",
  } as const;
  const label = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" } as const;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${m[status]}`}>
      {label[status]}
    </span>
  );
}