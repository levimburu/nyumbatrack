import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ago } from "@/lib/ownerFormat";

export const Route = createFileRoute("/_authenticated/owner/support")({
  component: OwnerSupport,
});

const db = supabase as any;
const input = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none";
const TYPE_LABEL: Record<string, string> = { company_senior_officer: "Senior Officer code", company_staff: "Property Manager code", agent_invite: "Agent code", landlord_signup: "Landlord code" };

function OwnerSupport() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [searched, setSearched] = useState("");

  const { data: pending } = useQuery({
    queryKey: ["owner-pending-invites"],
    queryFn: async () => { const { data, error } = await db.rpc("owner_pending_invites"); if (error) throw error; return (data ?? []) as any[]; },
  });

  const search = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await db.rpc("owner_find_user", { _email: email });
      if (error) throw error;
      setResult(data); setSearched(email.trim());
      qc.invalidateQueries({ queryKey: ["owner-actions"] });
    } catch (e: any) { toast.error(e?.message ?? "Search failed"); }
    finally { setBusy(false); }
  };

  const revoke = async (code: string) => {
    if (!confirm(`Cancel code ${code}? It will stop working.`)) return;
    const { error } = await db.rpc("owner_revoke_invite", { _code: code });
    if (error) { toast.error(error.message); return; }
    toast.success("Code cancelled");
    qc.invalidateQueries({ queryKey: ["owner-pending-invites"] });
    qc.invalidateQueries({ queryKey: ["owner-actions"] });
    if (searched) search();
  };

  const u = result?.user;
  const lockedUnused = (result?.invites ?? []).filter((i: any) => !i.used);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Support</h1>
        <p className="text-sm text-muted-foreground">Look up a person by email to see why they can't sign up or log in.</p>
      </div>

      <div className="card-surface space-y-3 p-4">
        <div className="flex gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="Their email address" className={input} />
          <button onClick={search} disabled={busy || !email.trim()} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--k-166534)" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
          </button>
        </div>

        {result && (
          <div className="space-y-3 text-sm">
            {!u && <div className="rounded-lg bg-amber-50 p-3 text-amber-900">No account exists for {searched}. {lockedUnused.length ? "They have an unused code locked to this email, so they can sign up with it." : "They can sign up if they have a code that isn't locked to a different email."}</div>}
            {u && (
              <div className="rounded-lg border border-border p-3">
                <div className="font-semibold">{u.full_name ?? u.email}</div>
                <div className="text-muted-foreground">{u.email} · account type: {u.role ?? "unknown"}</div>
                <div className="text-muted-foreground">Created {ago(u.created_at)} · last login {ago(u.last_sign_in_at)} · email {u.email_confirmed ? "confirmed" : "not confirmed"}</div>
                <div className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">This email already has an account, so it can't be used to sign up again. They should log in instead.</div>
              </div>
            )}
            {(result.memberships ?? []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Companies</div>
                {result.memberships.map((m: any, i: number) => (
                  <div key={i}>{m.company} · {m.role === "senior_officer" ? "Senior Officer" : "Property Manager"}{m.status === "suspended" ? " · suspended" : ""}</div>
                ))}
              </div>
            )}
            {(result.invites ?? []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Codes locked to this email</div>
                {result.invites.map((i: any) => (
                  <div key={i.code} className="flex items-center justify-between">
                    <span><span className="font-mono">{i.code}</span> · {TYPE_LABEL[i.type] ?? i.type}{i.company ? ` · ${i.company}` : ""}</span>
                    <span className={i.used ? "text-muted-foreground" : "text-green-700"}>{i.used ? "Used" : "Unused"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card-surface space-y-2 p-4">
        <div className="text-sm font-semibold">Unused company codes ({(pending ?? []).length})</div>
        {(pending ?? []).length === 0 && <div className="text-sm text-muted-foreground">None.</div>}
        {(pending ?? []).map((p) => (
          <div key={p.code} className="flex items-center justify-between gap-2 text-sm">
            <span><span className="font-mono">{p.code}</span> · {TYPE_LABEL[p.code_type] ?? p.code_type} · {p.company_name}{p.intended_email ? <span className="text-muted-foreground"> · {p.intended_email}</span> : null}</span>
            <button onClick={() => revoke(p.code)} className="text-xs font-semibold text-red-600">Cancel</button>
          </div>
        ))}
      </div>
    </div>
  );
}
