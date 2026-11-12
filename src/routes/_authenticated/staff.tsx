import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { CompanyInvites } from "@/components/CompanyInvites";

export const Route = createFileRoute("/_authenticated/staff")({
  component: StaffPage,
});

const db = supabase as any;

function StaffPage() {
  const qc = useQueryClient();
  const { data: access, isLoading: loadingAccess } = useCompanyAccess();
  const [picked, setPicked] = useState<string | null>(null);
  const company = access?.officerCompanies.find((c) => c.id === picked) ?? access?.officerCompanies[0];
  const cid = company?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["staff", cid],
    enabled: !!cid,
    queryFn: async () => {
      const [ms, props] = await Promise.all([
        db.from("company_members").select("user_id, role").eq("company_id", cid),
        db.from("properties").select("id, name, location").eq("company_id", cid).order("name"),
      ]);
      if (ms.error) throw ms.error;
      if (props.error) throw props.error;
      const members = (ms.data ?? []) as { user_id: string; role: string }[];
      const properties = (props.data ?? []) as { id: string; name: string; location: string | null }[];
      const { data: ps } = members.length
        ? await db.from("profiles").select("id, full_name, email").in("id", members.map((m) => m.user_id))
        : { data: [] };
      const pmap = new Map((ps ?? []).map((p: any) => [p.id, p]));
      const propIds = properties.map((p) => p.id);
      const { data: as } = propIds.length
        ? await db.from("property_assignments").select("property_id, user_id").in("property_id", propIds)
        : { data: [] };
      return {
        members: members.map((m) => ({ ...m, profile: pmap.get(m.user_id) as any })),
        properties,
        assignments: (as ?? []) as { property_id: string; user_id: string }[],
      };
    },
  });

  if (loadingAccess) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!company) return <div className="p-6 text-sm text-muted-foreground">Only a company's Senior Officer can manage staff.</div>;

  const refresh = () => qc.invalidateQueries({ queryKey: ["staff", cid] });
  const isAssigned = (pid: string, uid: string) => !!data?.assignments.find((a) => a.property_id === pid && a.user_id === uid);

  const toggle = async (pid: string, uid: string) => {
    const assigned = isAssigned(pid, uid);
    const { error } = assigned
      ? await db.from("property_assignments").delete().eq("property_id", pid).eq("user_id", uid)
      : await db.from("property_assignments").insert({ property_id: pid, user_id: uid });
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const remove = async (uid: string, label: string) => {
    if (!confirm(`Remove ${label} from ${company.name}? They will lose access to all company properties.`)) return;
    const propIds = (data?.properties ?? []).map((p) => p.id);
    if (propIds.length) await db.from("property_assignments").delete().eq("user_id", uid).in("property_id", propIds);
    const { error } = await db.from("company_members").delete().eq("company_id", cid).eq("user_id", uid);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    refresh();
  };

  const changeRole = async (uid: string, role: "senior_officer" | "property_manager", label: string) => {
    const msg = role === "senior_officer"
      ? `Make ${label} a Senior Officer? They will see every company property and can manage staff.`
      : `Make ${label} a Property Manager? They will only see properties you assign to them.`;
    if (!confirm(msg)) return;
    const { error } = await db.rpc("set_member_role", { _company: cid, _user: uid, _role: role });
    if (error) { toast.error(error.message); return; }
    toast.success("Role changed");
    refresh();
  };

  const officers = (data?.members ?? []).filter((m) => m.role === "senior_officer");
  const managers = (data?.members ?? []).filter((m) => m.role === "property_manager");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Staff</h1>
        {access!.officerCompanies.length > 1 ? (
          <select value={company.id} onChange={(e) => setPicked(e.target.value)} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
            {access!.officerCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground">{company.name}</p>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      <div className="card-surface space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Senior Officers</div>
        {officers.map((m) => (
          <div key={m.user_id} className="flex items-center justify-between text-sm">
            <span>{m.profile?.full_name ?? m.profile?.email}{m.user_id === access!.userId ? " (you)" : ""}</span>
            <div className="flex items-center gap-3">
              {officers.length > 1 && (
                <button onClick={() => changeRole(m.user_id, "property_manager", m.profile?.full_name ?? "this person")} className="text-xs font-semibold text-green-800">Make Property Manager</button>
              )}
              {m.user_id !== access!.userId && (
                <button onClick={() => remove(m.user_id, m.profile?.full_name ?? "this person")} className="text-red-600"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          </div>
        ))}
        <CompanyInvites companyId={company.id} role="senior_officer" label="Invite another Senior Officer" />
      </div>

      <div className="card-surface space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Property Managers</div>
        {managers.length === 0 && <div className="text-sm text-muted-foreground">No property managers yet. Create a code below and send it to them.</div>}
        {managers.map((m) => (
          <div key={m.user_id} className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{m.profile?.full_name ?? m.profile?.email}</div>
                <div className="text-xs text-muted-foreground">{m.profile?.email}</div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => changeRole(m.user_id, "senior_officer", m.profile?.full_name ?? "this person")} className="text-xs font-semibold text-green-800">Make Senior Officer</button>
                <button onClick={() => remove(m.user_id, m.profile?.full_name ?? "this person")} className="text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Can see these properties</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(data?.properties ?? []).length === 0 && <span className="text-xs text-muted-foreground">This company has no properties yet.</span>}
              {(data?.properties ?? []).map((p) => {
                const on = isAssigned(p.id, m.user_id);
                return (
                  <button key={p.id} onClick={() => toggle(p.id, m.user_id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-green-700 bg-green-700 text-white" : "border-border bg-white text-foreground"}`}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <CompanyInvites companyId={company.id} role="property_manager" label="Invite a Property Manager" />
      </div>
    </div>
  );
}
