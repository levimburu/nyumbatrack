import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CompanyInvites } from "@/components/CompanyInvites";
import { ago, isOverdue, type CompanyStat } from "@/lib/ownerFormat";
import { formatKES } from "@/lib/format";
import { CompanyProfileForm, profileToValues } from "@/components/CompanyProfileForm";

export const Route = createFileRoute("/_authenticated/owner/companies")({
  component: OwnerCompanies,
});

const db = supabase as any;
const input = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none";

function OwnerCompanies() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["owner-stats"] });
    qc.invalidateQueries({ queryKey: ["owner-actions"] });
    qc.invalidateQueries({ queryKey: ["owner-totals"] });
    qc.invalidateQueries({ queryKey: ["owner-members"] });
  };

  const { data: stats, isLoading } = useQuery({
    queryKey: ["owner-stats"],
    queryFn: async () => { const { data, error } = await db.rpc("owner_company_stats"); if (error) throw error; return (data ?? []) as CompanyStat[]; },
  });
  const companies = (stats ?? []).filter((c) => c.kind === "company");

  const { data: members } = useQuery({
    queryKey: ["owner-members", companies.map((c) => c.id).join(",")],
    enabled: companies.length > 0,
    queryFn: async () => {
      const { data: ms } = await db.from("company_members").select("company_id, user_id, role").in("company_id", companies.map((c) => c.id));
      const uids = Array.from(new Set((ms ?? []).map((m: any) => m.user_id)));
      const { data: ps } = uids.length ? await db.from("profiles").select("id, full_name, email").in("id", uids) : { data: [] };
      const pmap = new Map((ps ?? []).map((p: any) => [p.id, p]));
      return (ms ?? []).map((m: any) => ({ ...m, profile: pmap.get(m.user_id) })) as any[];
    },
  });

  const create = async (values: Record<string, string>) => {
    try {
      const { error } = await db.rpc("create_company_full", { _d: values });
      if (error) throw error;
      toast.success("Company created");
      setShowNew(false);
      refresh();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't create the company"); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Companies</h1>
        <p className="text-sm text-muted-foreground">Create a company, give its first Senior Officer an invite code, and track billing.</p>
      </div>

      <div className="card-surface space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">New company</div>
          <button onClick={() => setShowNew((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-green-800">
            <Plus className="h-4 w-4" /> {showNew ? "Close" : "Add a company"}
          </button>
        </div>
        {showNew && <CompanyProfileForm mode="owner-create" initial={profileToValues(null)} submitLabel="Create company" onSubmit={create} />}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {companies.map((c) => (
        <CompanyCard key={c.id} c={c} members={(members ?? []).filter((m) => m.company_id === c.id)} onChanged={refresh} />
      ))}
    </div>
  );
}

function CompanyCard({ c, members, onChanged }: { c: CompanyStat; members: any[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState(c.plan ?? "");
  const [price, setPrice] = useState(c.price_kes != null ? String(c.price_kes) : "");
  const [paidUntil, setPaidUntil] = useState(c.paid_until ?? "");
  const [notes, setNotes] = useState(c.billing_notes ?? "");
  const [busy, setBusy] = useState(false);
  const suspended = c.status === "suspended";

  const toggle = async () => {
    const next = suspended ? "active" : "suspended";
    if (!confirm(suspended
      ? `Reactivate ${c.name}? Their staff get access again.`
      : `Suspend ${c.name}? Everyone in the company loses access until you reactivate it. Their data is kept.`)) return;
    const { error } = await db.rpc("owner_set_company_status", { _company: c.id, _status: next });
    if (error) { toast.error(error.message); return; }
    toast.success(suspended ? "Reactivated" : "Suspended");
    onChanged();
  };

  const saveBilling = async () => {
    setBusy(true);
    const { error } = await db.rpc("owner_update_billing", {
      _company: c.id, _plan: plan, _price: price.trim() ? Number(price) : null, _paid_until: paidUntil || null, _notes: notes,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Billing saved");
    setEditing(false);
    onChanged();
  };

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5" style={{ color: "#166534" }} />
          <div className="font-display text-lg font-bold">{c.name}</div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${suspended ? "bg-red-100 text-red-700" : "bg-green-100 text-green-800"}`}>{suspended ? "Suspended" : "Active"}</span>
        </div>
        <button onClick={toggle} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${suspended ? "border-green-700 text-green-800" : "border-red-300 text-red-600"}`}>
          {suspended ? "Reactivate" : "Suspend"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><div className="text-xs text-muted-foreground">Properties</div>{c.properties}</div>
        <div><div className="text-xs text-muted-foreground">Units</div>{c.units}</div>
        <div><div className="text-xs text-muted-foreground">Tenants</div>{c.tenants}</div>
        <div><div className="text-xs text-muted-foreground">Last active</div>{ago(c.last_active)}</div>
      </div>

      <div className="rounded-xl border border-border p-3 text-sm">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Billing</div>
          <button onClick={() => setEditing((v) => !v)} className="text-xs font-semibold text-green-800">{editing ? "Close" : "Edit"}</button>
        </div>
        {!editing && (
          <div className="mt-1 text-muted-foreground">
            {c.plan || c.price_kes != null || c.paid_until ? (
              <>
                {c.plan ?? "No plan"}{c.price_kes != null ? ` · ${formatKES(Number(c.price_kes))}` : ""}
                {c.paid_until ? <> · paid until <span className={isOverdue(c) ? "font-semibold text-red-600" : ""}>{c.paid_until}{isOverdue(c) ? " (overdue)" : ""}</span></> : ""}
                {c.billing_notes ? <div className="mt-0.5">{c.billing_notes}</div> : null}
              </>
            ) : "Nothing recorded yet."}
          </div>
        )}
        {editing && (
          <div className="mt-2 space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <input className={input} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Plan (e.g. Monthly)" />
              <input className={input} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (KES)" />
              <input className={input} type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
            </div>
            <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
            <button onClick={saveBilling} disabled={busy} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#166534" }}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        )}
      </div>

      <CompanyDetails companyId={c.id} onChanged={onChanged} />

      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People ({members.length})</div>
        {members.length === 0 && <div className="text-sm text-muted-foreground">No one has joined yet.</div>}
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center justify-between text-sm">
            <span>{m.profile?.full_name ?? m.profile?.email ?? m.user_id}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.role === "senior_officer" ? "Senior Officer" : "Property Manager"}</span>
          </div>
        ))}
      </div>
      <CompanyInvites companyId={c.id} role="senior_officer" label="Invite a Senior Officer" />
    </div>
  );
}

function CompanyDetails({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["owner-company-profile", companyId],
    enabled: open,
    queryFn: async () => { const { data, error } = await db.rpc("owner_company_profile", { _company: companyId }); if (error) throw error; return data as Record<string, any>; },
  });
  const save = async (values: Record<string, string>) => {
    const { error } = await db.rpc("owner_update_company_profile", { _company: companyId, _d: values });
    if (error) { toast.error(error.message); return; }
    toast.success("Details saved");
    qc.invalidateQueries({ queryKey: ["owner-company-profile", companyId] });
    onChanged();
  };
  return (
    <div className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Company details</div>
        <button onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-green-800">{open ? "Close" : "View / edit"}</button>
      </div>
      {open && !data && <div className="mt-2 text-muted-foreground">Loading…</div>}
      {open && data && (
        <div className="mt-3"><CompanyProfileForm key={JSON.stringify(data)} mode="owner-edit" initial={profileToValues(data)} submitLabel="Save details" onSubmit={save} /></div>
      )}
    </div>
  );
}
