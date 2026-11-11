import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ago, daysSince, isOverdue, type CompanyStat } from "@/lib/ownerFormat";

export const Route = createFileRoute("/_authenticated/owner/")({
  component: OwnerOverview,
});

const db = supabase as any;

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function OwnerOverview() {
  const { data: totals } = useQuery({
    queryKey: ["owner-totals"],
    queryFn: async () => { const { data, error } = await db.rpc("owner_totals"); if (error) throw error; return data as Record<string, number>; },
  });
  const { data: stats } = useQuery({
    queryKey: ["owner-stats"],
    queryFn: async () => { const { data, error } = await db.rpc("owner_company_stats"); if (error) throw error; return (data ?? []) as CompanyStat[]; },
  });
  const { data: actions } = useQuery({
    queryKey: ["owner-actions"],
    queryFn: async () => { const { data, error } = await db.rpc("owner_recent_actions", { _limit: 15 }); if (error) throw error; return (data ?? []) as any[]; },
  });

  const companies = (stats ?? []).filter((c) => c.kind === "company");
  const individuals = (stats ?? []).filter((c) => c.kind === "individual").sort((a, b) => (b.last_active ?? "").localeCompare(a.last_active ?? ""));

  const attention: { id: string; name: string; reason: string }[] = [];
  for (const c of companies) {
    const age = daysSince(c.created_at) ?? 0;
    const idle = daysSince(c.last_active);
    if (c.status === "suspended") attention.push({ id: c.id, name: c.name, reason: "Suspended" });
    else if (isOverdue(c)) attention.push({ id: c.id, name: c.name, reason: `Payment overdue since ${c.paid_until}` });
    else if (c.last_active === null && age >= 2) attention.push({ id: c.id, name: c.name, reason: "Nobody has logged in yet" });
    else if (idle !== null && idle >= 14) attention.push({ id: c.id, name: c.name, reason: `No one has logged in for ${idle} days` });
    else if (c.properties === 0 && age >= 7) attention.push({ id: c.id, name: c.name, reason: "No properties registered after a week" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground">Counts only. You can't see anyone's private data from here.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Companies" value={totals?.companies ?? "—"} />
        <Tile label="Individual landlords" value={totals?.individuals ?? "—"} />
        <Tile label="Staff accounts" value={totals?.staff_users ?? "—"} />
        <Tile label="Properties" value={totals?.properties ?? "—"} />
        <Tile label="Units" value={totals?.units ?? "—"} />
        <Tile label="Tenant records" value={totals?.tenant_records ?? "—"} />
      </div>

      <div className="card-surface space-y-2 p-4">
        <div className="text-sm font-semibold">Needs your attention ({attention.length})</div>
        {attention.length === 0 && <div className="text-sm text-muted-foreground">Nothing right now.</div>}
        {attention.map((a) => (
          <div key={a.id + a.reason} className="flex items-center justify-between text-sm">
            <span className="font-medium">{a.name}</span><span className="text-amber-700">{a.reason}</span>
          </div>
        ))}
      </div>

      <div className="card-surface overflow-x-auto p-4">
        <div className="mb-2 text-sm font-semibold">Companies</div>
        {companies.length === 0 && <div className="text-sm text-muted-foreground">No companies yet. Create one under Companies.</div>}
        {companies.length > 0 && (
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1">Company</th><th>Status</th><th>Properties</th><th>Tenants</th><th>Last active</th><th>Paid until</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2 font-medium">{c.name}<div className="text-xs font-normal text-muted-foreground">{c.officer_email ?? "No Senior Officer yet"}</div></td>
                  <td>{c.status === "suspended" ? <span className="text-red-600">Suspended</span> : "Active"}</td>
                  <td>{c.properties}</td><td>{c.tenants}</td><td>{ago(c.last_active)}</td>
                  <td>{c.paid_until ? <span className={isOverdue(c) ? "font-semibold text-red-600" : ""}>{c.paid_until}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card-surface overflow-x-auto p-4">
        <div className="mb-2 text-sm font-semibold">Individual landlords ({individuals.length})</div>
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1">Account</th><th>Properties</th><th>Tenants</th><th>Last active</th></tr></thead>
          <tbody>
            {individuals.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="py-2">{c.officer_email ?? c.name}</td><td>{c.properties}</td><td>{c.tenants}</td><td>{ago(c.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-surface space-y-1 p-4">
        <div className="mb-1 text-sm font-semibold">Your recent activity</div>
        {(actions ?? []).length === 0 && <div className="text-sm text-muted-foreground">Nothing logged yet.</div>}
        {(actions ?? []).map((a, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-sm">
            <span><span className="font-medium">{a.action.replace(/_/g, " ")}</span>{a.company_name ? ` · ${a.company_name}` : ""}{a.detail ? <span className="text-muted-foreground"> · {a.detail}</span> : null}</span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{ago(a.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
