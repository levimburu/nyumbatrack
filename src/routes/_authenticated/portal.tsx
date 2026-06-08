import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatKES, formatDate } from "@/lib/format";
import { Download, Home, Wallet, Calendar } from "lucide-react";
import { downloadReceipt } from "@/lib/receipt";
import { StatCard } from "@/components/StatCard";

export const Route = createFileRoute("/_authenticated/portal")({
  component: TenantPortal,
});

function TenantPortal() {
  const { user } = useAuth();

  const { data: tenant } = useQuery({
    queryKey: ["my-tenant", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: payments } = useQuery({
    queryKey: ["my-payments", tenant?.id],
    enabled: !!tenant,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").eq("tenant_id", tenant!.id).order("paid_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (!tenant) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card-surface p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">Welcome</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your tenant record hasn't been linked to this account yet. Please ask your landlord to link your email
            ({user?.email}) to your unit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">My residence</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Hello, {tenant.full_name.split(" ")[0]}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Current balance" value={formatKES(tenant.balance)} icon={Wallet} tone={Number(tenant.balance) > 0 ? "warning" : "success"} />
        <StatCard label="Monthly rent" value={formatKES(tenant.rent_amount)} icon={Home} tone="gold" />
        <StatCard label="Due day" value={`Day ${tenant.due_day}`} icon={Calendar} hint="of each month" />
      </div>

      <div className="card-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-semibold">Payment history</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-5 py-3">Date</th><th>Method</th><th>Reference</th><th>Amount</th><th className="pr-5 text-right">Receipt</th></tr>
          </thead>
          <tbody>
            {payments?.map((p) => (
              <tr key={p.id} className="border-t border-border/60">
                <td className="px-5 py-3 text-muted-foreground">{formatDate(p.paid_on)}</td>
                <td><span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium uppercase">{p.method}</span></td>
                <td className="text-muted-foreground">{p.reference ?? "—"}</td>
                <td className="font-display font-semibold text-success">+{formatKES(p.amount)}</td>
                <td className="pr-5 text-right">
                  <button onClick={() => downloadReceipt({
                    tenantName: tenant.full_name, unit: tenant.unit,
                    amount: Number(p.amount), paidOn: p.paid_on, method: p.method,
                    reference: p.reference, receiptNo: p.id.slice(0, 8).toUpperCase(),
                  })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Download className="h-3.5 w-3.5" /> PDF
                  </button>
                </td>
              </tr>
            ))}
            {!payments?.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
