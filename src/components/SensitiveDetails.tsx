import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";

const db = supabase as any;

const FIELDS: { key: "id_number" | "kra_pin" | "payout_details"; label: string }[] = [
  { key: "id_number", label: "ID number" },
  { key: "kra_pin", label: "KRA PIN" },
  { key: "payout_details", label: "Payout details" },
];

/**
 * Masked landlord details. Senior Officers can reveal them (every reveal is logged).
 * Property Managers must first ask a Senior Officer; an approval lasts 12 hours.
 */
export function SensitiveDetails({ landlordId, companyId }: { landlordId: string; companyId: string }) {
  const qc = useQueryClient();
  const { data: access } = useCompanyAccess();
  const isOfficer = !!access?.memberships.some((m) => m.company_id === companyId && m.role === "senior_officer");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data: masks } = useQuery({
    queryKey: ["landlord-masks", landlordId],
    queryFn: async () => {
      const { data, error } = await db.rpc("landlord_masks", { _lid: landlordId });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as { has_id: boolean; id_last4: string | null; has_kra: boolean; has_payout: boolean } | null;
    },
  });

  const { data: status } = useQuery({
    queryKey: ["my-access-status", landlordId],
    enabled: !isOfficer && !!access,
    queryFn: async () => {
      const { data, error } = await db.rpc("my_access_status", { _lid: landlordId });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as { status: string; expires_at: string | null } | null;
    },
  });

  const approved = status?.status === "approved" && !!status.expires_at && new Date(status.expires_at) > new Date();
  const pending = status?.status === "pending";
  const canReveal = isOfficer || approved;

  const present: Record<string, boolean> = {
    id_number: !!masks?.has_id, kra_pin: !!masks?.has_kra, payout_details: !!masks?.has_payout,
  };
  const maskOf = (key: string) =>
    key === "id_number" && masks?.id_last4 ? `•••• ${masks.id_last4}` : "••••••••";

  const reveal = async (key: string) => {
    setBusy(key);
    try {
      const { data, error } = await db.rpc("get_landlord_sensitive", { _lid: landlordId, _field: key });
      if (error) throw error;
      setShown((s) => ({ ...s, [key]: (data as string) ?? "" }));
      setTimeout(() => setShown((s) => { const n = { ...s }; delete n[key]; return n; }), 30_000);
      qc.invalidateQueries({ queryKey: ["audit-log"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't load that");
      qc.invalidateQueries({ queryKey: ["my-access-status", landlordId] });
    } finally {
      setBusy(null);
    }
  };

  const request = async () => {
    setBusy("request");
    try {
      const { error } = await db.rpc("request_sensitive_access", { _lid: landlordId, _reason: reason });
      if (error) throw error;
      toast.success("Request sent to a Senior Officer");
      setReason("");
      qc.invalidateQueries({ queryKey: ["my-access-status", landlordId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the request");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Lock className="h-4 w-4" /> Sensitive details
      </div>
      <div className="space-y-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{f.label}</span>
            {!present[f.key] ? (
              <span className="text-xs text-muted-foreground">Not recorded</span>
            ) : shown[f.key] !== undefined ? (
              <span className="flex items-center gap-2">
                <span className="font-mono font-semibold break-all text-right">{shown[f.key] || "—"}</span>
                <button onClick={() => setShown((s) => { const n = { ...s }; delete n[f.key]; return n; })} aria-label="Hide"><EyeOff className="h-4 w-4" /></button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="font-mono">{maskOf(f.key)}</span>
                {canReveal && (
                  <button onClick={() => reveal(f.key)} disabled={busy === f.key} aria-label={`Show ${f.label}`} className="text-green-800">
                    {busy === f.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        {isOfficer && <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Every time you show a detail, it is recorded in the audit log.</span>}
        {!isOfficer && approved && <span>Approved until {new Date(status!.expires_at!).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}. Each view is logged.</span>}
        {!isOfficer && pending && <span>Waiting for a Senior Officer to approve your request.</span>}
      </div>

      {!isOfficer && !approved && !pending && (
        <div className="mt-3 space-y-2">
          {status?.status === "denied" && <div className="text-xs text-red-600">Your last request was declined.</div>}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Why do you need these details?" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none" />
          <button onClick={request} disabled={busy === "request"} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#166534" }}>
            {busy === "request" && <Loader2 className="h-4 w-4 animate-spin" />} Request access (valid 12 hours)
          </button>
        </div>
      )}
    </div>
  );
}
