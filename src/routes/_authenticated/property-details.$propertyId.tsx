import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, FileText, Loader2, MapPin, Phone, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { SensitiveDetails } from "@/components/SensitiveDetails";
import { ownershipLabel, telHref } from "@/lib/contacts";

export const Route = createFileRoute("/_authenticated/property-details/$propertyId")({
  component: PropertyDetailsPage,
});

const db = supabase as any;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

function PropertyDetailsPage() {
  const { propertyId } = Route.useParams();
  const qc = useQueryClient();
  const { data: access } = useCompanyAccess();

  const { data: property, isLoading } = useQuery({
    queryKey: ["property-info", propertyId],
    queryFn: async () => {
      const { data, error } = await db.from("properties").select("id, name, location, description, total_units, photo_url, company_id").eq("id", propertyId).maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; location: string | null; description: string | null; total_units: number; photo_url: string | null; company_id: string | null } | null;
    },
  });
  const isOfficer = !!access?.memberships.some((m) => m.company_id === property?.company_id && m.role === "senior_officer");

  const { data: owners } = useQuery({
    queryKey: ["property-owners", propertyId],
    queryFn: async () => {
      const { data, error } = await db.rpc("property_owner_summaries", { _property: propertyId });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: caretakers } = useQuery({
    queryKey: ["property-caretakers", propertyId],
    queryFn: async () => {
      const { data, error } = await db.from("caretakers").select("id, full_name, phone, start_date, notes").eq("property_id", propertyId).order("created_at");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; phone: string; start_date: string | null; notes: string | null }[];
    },
  });

  const [title, setTitle] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ctName, setCtName] = useState("");
  const [ctPhone, setCtPhone] = useState("");

  const revealTitle = async (ownerId: string, openDoc: boolean) => {
    setBusy(ownerId + (openDoc ? "doc" : "t"));
    try {
      const { data, error } = await db.rpc("get_ownership_details", { _owner: ownerId });
      if (error) throw error;
      const row = (data ?? [])[0] as { title_number: string; document_path: string } | undefined;
      if (!row) throw new Error("No ownership details recorded");
      if (openDoc) {
        const { data: signed, error: e2 } = await supabase.storage.from("ownership-docs").createSignedUrl(row.document_path, 60);
        if (e2) throw e2;
        window.open(signed.signedUrl, "_blank", "noopener");
      } else {
        setTitle((t) => ({ ...t, [ownerId]: row.title_number }));
        setTimeout(() => setTitle((t) => { const n = { ...t }; delete n[ownerId]; return n; }), 30_000);
      }
      qc.invalidateQueries({ queryKey: ["audit-log"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't load that");
    } finally {
      setBusy(null);
    }
  };

  const addCaretaker = async () => {
    if (!ctName.trim() || !ctPhone.trim()) { toast.error("Name and phone are required"); return; }
    setBusy("add");
    const { error } = await db.from("caretakers").insert({ property_id: propertyId, full_name: ctName.trim(), phone: ctPhone.trim() });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setCtName(""); setCtPhone("");
    qc.invalidateQueries({ queryKey: ["property-caretakers", propertyId] });
  };
  const [editCt, setEditCt] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const saveCaretaker = async (id: string) => {
    if (!editName.trim() || !editPhone.trim()) { toast.error("Name and phone are required"); return; }
    const { error } = await db.from("caretakers").update({ full_name: editName.trim(), phone: editPhone.trim() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEditCt(null);
    qc.invalidateQueries({ queryKey: ["property-caretakers", propertyId] });
  };
  const removeCaretaker = async (id: string) => {
    if (!confirm("Remove this caretaker?")) return;
    const { error } = await db.from("caretakers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["property-caretakers", propertyId] });
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!property) return <div className="p-6 text-sm text-muted-foreground">Property not found, or you don't have access to it.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link to="/properties" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Properties</Link>
      <div className="card-surface overflow-hidden">
        {property.photo_url && <img src={property.photo_url} alt={property.name} className="h-40 w-full object-cover" />}
        <div className="p-4">
          <h1 className="font-display text-2xl font-bold">{property.name}</h1>
          {property.location && <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{property.location}</div>}
          {property.description && <p className="mt-2 text-sm">{property.description}</p>}
        </div>
      </div>

      <div className="card-surface space-y-3 p-4">
        <div className="font-display text-base font-bold">Landlord and ownership</div>
        {(owners ?? []).length === 0 && <div className="text-sm text-muted-foreground">No landlord record for this property.</div>}
        {(owners ?? []).map((o) => (
          <div key={o.owner_id} className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-base font-semibold"><User className="h-4 w-4" />{o.full_name}
                  {o.verified_at && <BadgeCheck className="h-4 w-4 text-green-700" aria-label="Ownership verified" />}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                  {o.phone && <a href={telHref(o.phone)} className="inline-flex items-center gap-1 font-medium text-green-800"><Phone className="h-3.5 w-3.5" />{o.phone}</a>}
                  {o.email && <span className="text-muted-foreground">{o.email}</span>}
                </div>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{ownershipLabel(o.ownership_type)}{Number(o.share_percent) < 100 ? ` · ${o.share_percent}%` : ""}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-xs text-muted-foreground">Agreement starts</div>{fmtDate(o.agreement_start)}</div>
              <div><div className="text-xs text-muted-foreground">Agreement ends</div>{fmtDate(o.agreement_end)}</div>
              <div><div className="text-xs text-muted-foreground">Ownership verified</div>{o.verified_at ? fmtDate(o.verified_at) : "Not verified"}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Title / LR number:</span>
              {title[o.owner_id] !== undefined
                ? <span className="font-mono font-semibold">{title[o.owner_id]}</span>
                : <button onClick={() => revealTitle(o.owner_id, false)} disabled={busy === o.owner_id + "t"} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium">
                    {busy === o.owner_id + "t" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Show"}
                  </button>}
              {isOfficer && (
                <button onClick={() => revealTitle(o.owner_id, true)} disabled={busy === o.owner_id + "doc"} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium">
                  {busy === o.owner_id + "doc" ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} Open document
                </button>
              )}
            </div>
            {property.company_id && <SensitiveDetails landlordId={o.landlord_id} companyId={property.company_id} />}
          </div>
        ))}
      </div>

      <div className="card-surface space-y-3 p-4">
        <div className="font-display text-base font-bold">Caretaker</div>
        {(caretakers ?? []).length === 0 && <div className="text-sm text-muted-foreground">No caretaker recorded.</div>}
        {(caretakers ?? []).map((c) => editCt === c.id ? (
          <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none" />
            <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none" />
            <button onClick={() => saveCaretaker(c.id)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--k-166534)" }}>Save</button>
            <button onClick={() => setEditCt(null)} className="text-sm text-muted-foreground">Cancel</button>
          </div>
        ) : (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div className="text-sm"><div className="font-semibold">{c.full_name}</div>{c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}</div>
            <div className="flex items-center gap-3">
              <a href={telHref(c.phone)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white" style={{ background: "var(--k-166534)" }}><Phone className="h-3.5 w-3.5" />{c.phone}</a>
              {isOfficer && <button onClick={() => { setEditCt(c.id); setEditName(c.full_name); setEditPhone(c.phone); }} className="text-xs font-semibold text-green-800">Edit</button>}
              {isOfficer && <button onClick={() => removeCaretaker(c.id)} className="text-red-600" aria-label="Remove caretaker"><Trash2 className="h-4 w-4" /></button>}
            </div>
          </div>
        ))}
        {isOfficer && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={ctName} onChange={(e) => setCtName(e.target.value)} placeholder="Name" className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none" />
            <input value={ctPhone} onChange={(e) => setCtPhone(e.target.value)} placeholder="Phone" className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none" />
            <button onClick={addCaretaker} disabled={busy === "add"} className="inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--k-166534)" }}>
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
