import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";

export const Route = createFileRoute("/_authenticated/access")({
  component: AccessPage,
});

const db = supabase as any;
const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const FIELD_LABEL: Record<string, string> = { id_number: "ID number", kra_pin: "KRA PIN", payout_details: "Payout details", title_deed: "Title deed / LR" };

function AccessPage() {
  const qc = useQueryClient();
  const { data: access, isLoading: loadingAccess } = useCompanyAccess();
  const ids = (access?.officerCompanies ?? []).map((c) => c.id);

  const { data: names } = useQuery({
    queryKey: ["access-names", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const [{ data: ms }, { data: ls }] = await Promise.all([
        db.from("company_members").select("user_id").in("company_id", ids),
        db.from("landlords").select("id, full_name").in("company_id", ids),
      ]);
      const uids = Array.from(new Set((ms ?? []).map((m: any) => m.user_id)));
      const { data: ps } = uids.length ? await db.from("profiles").select("id, full_name, email").in("id", uids) : { data: [] };
      return {
        user: new Map((ps ?? []).map((p: any) => [p.id, p.full_name || p.email])) as Map<string, string>,
        landlord: new Map((ls ?? []).map((l: any) => [l.id, l.full_name])) as Map<string, string>,
      };
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["access-requests", ids.join(",")],
    enabled: ids.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db.from("access_requests").select("id, landlord_id, requested_by, reason, status, decided_at, expires_at, created_at")
        .in("company_id", ids).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: log } = useQuery({
    queryKey: ["audit-log", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await db.from("access_log").select("id, landlord_name, user_id, field, via, accessed_at")
        .in("company_id", ids).order("accessed_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (loadingAccess) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!ids.length) return <div className="p-6 text-sm text-muted-foreground">Only a company's Senior Officer can see this page.</div>;

  const decide = async (id: string, approve: boolean) => {
    const { error } = await db.rpc("decide_access_request", { _id: id, _approve: approve });
    if (error) { toast.error(error.message); return; }
    toast.success(approve ? "Approved for 12 hours" : "Declined");
    qc.invalidateQueries({ queryKey: ["access-requests"] });
  };

  const user = (id: string) => names?.user.get(id) ?? "Someone";
  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const decided = (requests ?? []).filter((r) => r.status !== "pending").slice(0, 15);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Access requests</h1>
        <p className="text-sm text-muted-foreground">Staff must ask before seeing a landlord's ID, KRA PIN, payout or title details. An approval lasts 12 hours.</p>
      </div>

      <div className="card-surface space-y-2 p-4">
        <div className="text-sm font-semibold">Waiting for you ({pending.length})</div>
        {pending.length === 0 && <div className="text-sm text-muted-foreground">No pending requests.</div>}
        {pending.map((r) => (
          <div key={r.id} className="rounded-xl border border-border p-3">
            <div className="text-sm"><span className="font-semibold">{user(r.requested_by)}</span> wants to see details for <span className="font-semibold">{names?.landlord.get(r.landlord_id) ?? "a landlord"}</span></div>
            {r.reason && <div className="mt-1 text-sm text-muted-foreground">“{r.reason}”</div>}
            <div className="mt-1 text-xs text-muted-foreground">{when(r.created_at)}</div>
            <div className="mt-2 flex gap-2">
              <button onClick={() => decide(r.id, true)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold text-white" style={{ background: "var(--k-166534)" }}><Check className="h-4 w-4" /> Approve</button>
              <button onClick={() => decide(r.id, false)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium"><X className="h-4 w-4" /> Decline</button>
            </div>
          </div>
        ))}
        {decided.length > 0 && <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent decisions</div>}
        {decided.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-sm">
            <span>{user(r.requested_by)} · {names?.landlord.get(r.landlord_id) ?? "landlord"}</span>
            <span className={r.status === "approved" ? "text-green-700" : "text-red-600"}>{r.status === "approved" ? "Approved" : "Declined"} {r.decided_at ? when(r.decided_at) : ""}</span>
          </div>
        ))}
      </div>

      <div className="card-surface space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Audit log — who viewed what</div>
        {(log ?? []).length === 0 && <div className="text-sm text-muted-foreground">Nothing has been viewed yet.</div>}
        <div className="divide-y divide-border">
          {(log ?? []).map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-semibold">{user(l.user_id)}</span> viewed {FIELD_LABEL[l.field] ?? l.field} of <span className="font-semibold">{l.landlord_name ?? "a landlord"}</span>
                <div className="text-xs text-muted-foreground">{l.via === "approval" ? "with approval" : "as Senior Officer"}</div>
              </div>
              <div className="whitespace-nowrap text-xs text-muted-foreground">{when(l.accessed_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
