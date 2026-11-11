import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { CompanyInvites } from "@/components/CompanyInvites";

export const Route = createFileRoute("/_authenticated/companies")({
  component: CompaniesPage,
});

const db = supabase as any;

function CompaniesPage() {
  const qc = useQueryClient();
  const { data: access, isLoading: loadingAccess } = useCompanyAccess();
  const [name, setName] = useState("");
  const [reg, setReg] = useState("");
  const [earb, setEarb] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: companies, isLoading } = useQuery({
    queryKey: ["platform-companies"],
    enabled: access?.isPlatformAdmin === true,
    queryFn: async () => {
      const { data: cs, error } = await db.from("companies").select("id, name, registration_no, earb_no, created_at").eq("kind", "company").order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (cs ?? []).map((c: any) => c.id);
      if (!ids.length) return [];
      const { data: ms } = await db.from("company_members").select("company_id, user_id, role").in("company_id", ids);
      const userIds = Array.from(new Set((ms ?? []).map((m: any) => m.user_id)));
      const { data: ps } = userIds.length ? await db.from("profiles").select("id, full_name, email").in("id", userIds) : { data: [] };
      const pmap = new Map((ps ?? []).map((p: any) => [p.id, p]));
      return (cs ?? []).map((c: any) => ({
        ...c,
        members: (ms ?? []).filter((m: any) => m.company_id === c.id).map((m: any) => ({ ...m, profile: pmap.get(m.user_id) })),
      }));
    },
  });

  if (loadingAccess) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!access?.isPlatformAdmin) return <div className="p-6 text-sm text-muted-foreground">This page is only for the NyumbaTrack owner.</div>;

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { error } = await db.rpc("create_company", { _name: name, _registration_no: reg || null, _earb_no: earb || null });
      if (error) throw error;
      toast.success("Company created");
      setName(""); setReg(""); setEarb("");
      qc.invalidateQueries({ queryKey: ["platform-companies"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create the company");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Companies</h1>
        <p className="text-sm text-muted-foreground">Create a company, then give its first Senior Officer an invite code.</p>
      </div>

      <div className="card-surface space-y-3 p-4">
        <div className="text-sm font-semibold">New company</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="Registration number (optional)" className="rounded-lg border border-border px-3 py-2 text-sm outline-none" />
          <input value={earb} onChange={(e) => setEarb(e.target.value)} placeholder="EARB number (optional)" className="rounded-lg border border-border px-3 py-2 text-sm outline-none" />
        </div>
        <button onClick={create} disabled={!name.trim() || busy} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#166534" }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create company
        </button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {(companies ?? []).map((c: any) => (
        <div key={c.id} className="card-surface space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" style={{ color: "#166534" }} />
            <div className="font-display text-lg font-bold">{c.name}</div>
          </div>
          {(c.registration_no || c.earb_no) && (
            <div className="text-xs text-muted-foreground">
              {c.registration_no ? `Reg: ${c.registration_no}` : ""}{c.registration_no && c.earb_no ? " · " : ""}{c.earb_no ? `EARB: ${c.earb_no}` : ""}
            </div>
          )}
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People ({c.members.length})</div>
            {c.members.length === 0 && <div className="text-sm text-muted-foreground">No one has joined yet.</div>}
            {c.members.map((m: any) => (
              <div key={m.user_id} className="flex items-center justify-between text-sm">
                <span>{m.profile?.full_name ?? m.profile?.email ?? m.user_id}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{m.role === "senior_officer" ? "Senior Officer" : "Property Manager"}</span>
              </div>
            ))}
          </div>
          <CompanyInvites companyId={c.id} role="senior_officer" label="Invite a Senior Officer" />
        </div>
      ))}
    </div>
  );
}
