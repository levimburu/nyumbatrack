import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone, Search, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { SensitiveDetails } from "@/components/SensitiveDetails";
import { telHref } from "@/lib/contacts";

export const Route = createFileRoute("/_authenticated/landlords")({
  component: LandlordsPage,
});

const db = supabase as any;
const input = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none";

interface Landlord { id: string; company_id: string; full_name: string; phone: string | null; email: string | null; consent_at: string | null }

function LandlordsPage() {
  const { data: access, isLoading: loadingAccess } = useCompanyAccess();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Landlord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["landlords-list"],
    enabled: !!access,
    queryFn: async () => {
      const { data: ls, error } = await db.from("landlords").select("id, company_id, full_name, phone, email, consent_at").order("full_name");
      if (error) throw error;
      const { data: os } = await db.from("property_owners").select("landlord_id, property_id");
      const pids = Array.from(new Set((os ?? []).map((o: any) => o.property_id)));
      const { data: ps } = pids.length ? await db.from("properties").select("id, name").in("id", pids.slice(0, 200)) : { data: [] };
      const pname = new Map((ps ?? []).map((p: any) => [p.id, p.name]));
      return (ls ?? []).map((l: Landlord) => ({
        ...l,
        properties: (os ?? []).filter((o: any) => o.landlord_id === l.id).map((o: any) => ({ id: o.property_id, name: (pname.get(o.property_id) as string) ?? "Property" })),
      })) as (Landlord & { properties: { id: string; name: string }[] })[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((l) => `${l.full_name} ${l.phone ?? ""} ${l.email ?? ""} ${l.properties.map((p) => p.name).join(" ")}`.toLowerCase().includes(q));
  }, [data, search]);

  if (loadingAccess) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!access?.memberships.some((m) => m.company?.kind === "company"))
    return <div className="p-6 text-sm text-muted-foreground">Landlord records are available to company accounts.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Landlords</h1>
        <p className="text-sm text-muted-foreground">Names and numbers are visible to staff. ID, KRA PIN and payout details need approval.</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone or property" className={`${input} pl-9`} />
      </div>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && filtered.length === 0 && <div className="text-sm text-muted-foreground">No landlords yet. They are added when a Senior Officer registers a property.</div>}
      <div className="space-y-2">
        {filtered.map((l) => (
          <button key={l.id} onClick={() => setOpen(l)} className="card-surface flex w-full items-center justify-between p-4 text-left hover:shadow-md">
            <div>
              <div className="flex items-center gap-2 font-semibold"><User className="h-4 w-4" />{l.full_name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{l.phone ?? "No phone"} · {l.properties.length} {l.properties.length === 1 ? "property" : "properties"}</div>
            </div>
          </button>
        ))}
      </div>
      {open && <LandlordModal landlord={open} properties={(data ?? []).find((l) => l.id === open.id)?.properties ?? []} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LandlordModal({ landlord, properties, onClose }: { landlord: Landlord; properties: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: access } = useCompanyAccess();
  const isOfficer = !!access?.memberships.some((m) => m.company_id === landlord.company_id && m.role === "senior_officer");
  const [name, setName] = useState(landlord.full_name);
  const [phone, setPhone] = useState(landlord.phone ?? "");
  const [email, setEmail] = useState(landlord.email ?? "");
  const [idn, setIdn] = useState("");
  const [kra, setKra] = useState("");
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      const { error } = await db.from("landlords").update({ full_name: name.trim(), phone: phone.trim() || null, email: email.trim() || null }).eq("id", landlord.id);
      if (error) throw error;
      if (idn || kra || payout) {
        const { error: e2 } = await db.rpc("set_landlord_sensitive", { _lid: landlord.id, _id: idn || null, _kra: kra || null, _payout: payout || null });
        if (e2) throw e2;
        setIdn(""); setKra(""); setPayout("");
        qc.invalidateQueries({ queryKey: ["landlord-masks", landlord.id] });
      }
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["landlords-list"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (properties.length) { toast.error("This landlord still owns properties and can't be deleted."); return; }
    if (!confirm(`Permanently delete ${landlord.full_name} and all their stored details? This cannot be undone.`)) return;
    const { error } = await db.from("landlords").delete().eq("id", landlord.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["landlords-list"] });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h2 className="font-display text-xl font-bold">{landlord.full_name}</h2>
          <button onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          {isOfficer ? (
            <div className="space-y-2">
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
                <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              </div>
            </div>
          ) : (
            <div className="text-sm">
              {landlord.phone && <a href={telHref(landlord.phone)} className="inline-flex items-center gap-1 font-medium text-green-800"><Phone className="h-3.5 w-3.5" />{landlord.phone}</a>}
              {landlord.email && <div className="text-muted-foreground">{landlord.email}</div>}
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Properties</div>
            {properties.length === 0 && <div className="text-sm text-muted-foreground">None</div>}
            {properties.map((p) => (
              <Link key={p.id} to="/property-details/$propertyId" params={{ propertyId: p.id }} className="block py-0.5 text-sm font-medium text-green-800">{p.name}</Link>
            ))}
          </div>
          <SensitiveDetails landlordId={landlord.id} companyId={landlord.company_id} />
          {isOfficer && (
            <div className="space-y-2 rounded-xl border border-border p-4">
              <div className="text-sm font-semibold">Update sensitive details</div>
              <div className="text-xs text-muted-foreground">Leave a box empty to keep what is stored.</div>
              <input className={input} value={idn} onChange={(e) => setIdn(e.target.value)} placeholder="National ID number" />
              <input className={input} value={kra} onChange={(e) => setKra(e.target.value)} placeholder="KRA PIN" />
              <input className={input} value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="Payout details" />
            </div>
          )}
          {isOfficer && (
            <div className="flex items-center justify-between gap-2">
              <button onClick={remove} className="inline-flex items-center gap-1 text-sm font-medium text-red-600"><Trash2 className="h-4 w-4" /> Delete landlord</button>
              <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#166534" }}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
