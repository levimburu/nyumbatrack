import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { CompanyProfileForm, profileToValues } from "@/components/CompanyProfileForm";
import { formatKES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/company")({
  component: CompanyPage,
});

const db = supabase as any;

const READ_ROWS: [string, string][] = [
  ["Legal name", "name"], ["Trading name", "trading_name"], ["Registration number", "registration_no"], ["KRA PIN", "kra_pin"],
  ["EARB licence", "earb_no"], ["Licence expires", "earb_expiry"], ["Address", "address"], ["Town", "town"], ["County", "county"],
  ["Phone", "phone"], ["Email", "email"], ["Main contact", "contact_name"], ["Contact phone", "contact_phone"],
];

function CompanyPage() {
  const qc = useQueryClient();
  const { data: access, isLoading: loadingAccess } = useCompanyAccess();
  const mine = (access?.memberships ?? []).filter((m) => m.company?.kind === "company");
  const [picked, setPicked] = useState<string | null>(null);
  const membership = mine.find((m) => m.company_id === picked) ?? mine[0];
  const cid = membership?.company_id;
  const isOfficer = membership?.role === "senior_officer";

  const { data: c } = useQuery({
    queryKey: ["my-company", cid],
    enabled: !!cid,
    queryFn: async () => { const { data, error } = await db.from("companies").select("*").eq("id", cid).maybeSingle(); if (error) throw error; return data as Record<string, any> | null; },
  });

  if (loadingAccess) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!membership) return <div className="p-6 text-sm text-muted-foreground">Company details are available to company accounts.</div>;

  const save = async (values: Record<string, string>) => {
    const { error } = await db.rpc("update_company_profile", { _company: cid, _d: values });
    if (error) { toast.error(error.message); return; }
    toast.success("Company details saved");
    qc.invalidateQueries({ queryKey: ["my-company", cid] });
  };

  const expiry = c?.earb_expiry ? new Date(c.earb_expiry) : null;
  const daysLeft = expiry ? Math.floor((expiry.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Company</h1>
        {mine.length > 1 ? (
          <select value={membership.company_id} onChange={(e) => setPicked(e.target.value)} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
            {mine.map((m) => <option key={m.company_id} value={m.company_id}>{m.company?.name}</option>)}
          </select>
        ) : <p className="text-sm text-muted-foreground">{membership.company?.name}</p>}
      </div>

      {daysLeft !== null && daysLeft <= 30 && (
        <div className={`rounded-xl p-3 text-sm ${daysLeft < 0 ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
          {daysLeft < 0 ? "Your EARB licence has expired." : `Your EARB licence expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`} Renew it and update the date below.
        </div>
      )}

      {c && (
        <div className="card-surface space-y-1 p-4 text-sm">
          <div className="mb-1 font-semibold">Your NyumbaTrack plan</div>
          <div className="text-muted-foreground">
            {c.plan ?? "No plan recorded"}{c.price_kes != null ? ` · ${formatKES(Number(c.price_kes))}` : ""}
            {c.paid_until ? ` · paid until ${c.paid_until}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">To change your plan or record a payment, contact NyumbaTrack.</div>
        </div>
      )}

      <div className="card-surface p-4">
        <div className="mb-3 font-semibold">Company details</div>
        {c && isOfficer && <CompanyProfileForm key={JSON.stringify(c)} mode="company" initial={profileToValues(c)} submitLabel="Save changes" onSubmit={save} />}
        {c && !isOfficer && (
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {READ_ROWS.map(([l, k]) => (
              <div key={k}><div className="text-xs text-muted-foreground">{l}</div>{c[k] ?? "—"}</div>
            ))}
            <div className="text-xs text-muted-foreground sm:col-span-2">Only a Senior Officer can change these details.</div>
          </div>
        )}
      </div>
    </div>
  );
}
