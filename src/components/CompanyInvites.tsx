import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy — select and copy it manually");
  }
}

/** Create invite codes for one company and list the ones not yet used. */
export function CompanyInvites({ companyId, role, label }: {
  companyId: string;
  role: "senior_officer" | "property_manager";
  label: string;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const { data: pending } = useQuery({
    queryKey: ["company-invites", companyId],
    queryFn: async () => {
      const { data, error } = await db.rpc("company_pending_invites", { _company: companyId });
      if (error) throw error;
      return (data ?? []) as { code: string; company_role: string; intended_email: string | null; created_at: string }[];
    },
  });
  const mine = (pending ?? []).filter((p) => p.company_role === role);

  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await db.rpc("create_company_invite", {
        _company: companyId, _role: role, _email: email.trim() || null,
      });
      if (error) throw error;
      setFresh(data as string);
      setEmail("");
      qc.invalidateQueries({ queryKey: ["company-invites", companyId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create the code");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (code: string) => {
    if (!confirm(`Cancel code ${code}? It will stop working.`)) return;
    const { error } = await db.rpc("revoke_company_invite", { _code: code });
    if (error) { toast.error(error.message); return; }
    toast.success("Code cancelled");
    qc.invalidateQueries({ queryKey: ["company-invites", companyId] });
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" /> {label}</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Their email (optional — locks the code to it)"
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none"
        />
        <button onClick={create} disabled={busy}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "#166534" }}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create code
        </button>
      </div>
      {fresh && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
          <span className="font-mono text-sm font-bold tracking-widest">{fresh}</span>
          <button onClick={() => copy(fresh)} className="flex items-center gap-1 text-xs font-semibold text-green-800"><Copy className="h-3.5 w-3.5" /> Copy</button>
        </div>
      )}
      {mine.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unused codes</div>
          {mine.map((p) => (
            <div key={p.code} className="flex items-center justify-between text-sm">
              <span><span className="font-mono">{p.code}</span>{p.intended_email ? <span className="text-muted-foreground"> · {p.intended_email}</span> : null}</span>
              <span className="flex items-center gap-3">
                <button onClick={() => copy(p.code)} className="text-xs font-semibold text-green-800">Copy</button>
                <button onClick={() => cancel(p.code)} className="text-xs font-semibold text-red-600">Cancel</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
