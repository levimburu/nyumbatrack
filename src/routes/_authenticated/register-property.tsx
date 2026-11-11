import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { OWNERSHIP_TYPES } from "@/lib/contacts";

export const Route = createFileRoute("/_authenticated/register-property")({
  component: RegisterPropertyPage,
});

const db = supabase as any;
const input = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card-surface space-y-3 p-4">
      <div>
        <div className="font-display text-base font-bold">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function RegisterPropertyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: access, isLoading } = useCompanyAccess();
  const [picked, setPicked] = useState<string | null>(null);
  const company = access?.officerCompanies.find((c) => c.id === picked) ?? access?.officerCompanies[0];
  const cid = company?.id;

  // property
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [totalUnits, setTotalUnits] = useState("1");
  const [description, setDescription] = useState("");
  // landlord
  const [landlordId, setLandlordId] = useState<string>("new");
  const [llName, setLlName] = useState("");
  const [llPhone, setLlPhone] = useState("");
  const [llEmail, setLlEmail] = useState("");
  const [llId, setLlId] = useState("");
  const [llKra, setLlKra] = useState("");
  const [llPayout, setLlPayout] = useState("");
  const [consent, setConsent] = useState(false);
  // ownership
  const [ownType, setOwnType] = useState("sole");
  const [share, setShare] = useState("100");
  const [title, setTitle] = useState("");
  const [docPath, setDocPath] = useState("");
  const [docName, setDocName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [agStart, setAgStart] = useState("");
  const [agEnd, setAgEnd] = useState("");
  // caretaker
  const [ctName, setCtName] = useState("");
  const [ctPhone, setCtPhone] = useState("");
  const [ctStart, setCtStart] = useState("");
  const [ctNotes, setCtNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: landlords } = useQuery({
    queryKey: ["company-landlords", cid],
    enabled: !!cid,
    queryFn: async () => {
      const { data, error } = await db.from("landlords").select("id, full_name, phone").eq("company_id", cid).order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; phone: string | null }[];
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!company) return <div className="p-6 text-sm text-muted-foreground">Only a company's Senior Officer can register a property.</div>;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${cid}/${crypto.randomUUID()}/${safe}`;
      const { error } = await supabase.storage.from("ownership-docs").upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      setDocPath(path); setDocName(file.name);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const missing =
      !name.trim() ? "Property name" :
      landlordId === "new" && !llName.trim() ? "Landlord name" :
      landlordId === "new" && !llPhone.trim() ? "Landlord phone" :
      landlordId === "new" && !consent ? "Landlord consent" :
      !title.trim() ? "Title / LR number" :
      !docPath ? "Ownership document" :
      !agStart ? "Agreement start date" :
      !ctName.trim() ? "Caretaker name" :
      !ctPhone.trim() ? "Caretaker phone" : null;
    if (missing) { toast.error(`${missing} is required`); return; }
    setSaving(true);
    try {
      const { data, error } = await db.rpc("register_property", {
        _company: cid,
        _prop: { name: name.trim(), location: location.trim() || null, description: description.trim() || null, total_units: Math.max(1, Number(totalUnits) || 1) },
        _landlord_id: landlordId === "new" ? null : landlordId,
        _new_landlord: landlordId === "new"
          ? { full_name: llName, phone: llPhone, email: llEmail, id_number: llId, kra_pin: llKra, payout_details: llPayout, consent }
          : null,
        _owner: { ownership_type: ownType, share_percent: share, title_number: title, document_path: docPath, agreement_start: agStart, agreement_end: agEnd || null },
        _caretaker: { full_name: ctName, phone: ctPhone, start_date: ctStart || null, notes: ctNotes },
      });
      if (error) throw error;
      toast.success("Property registered");
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["company-landlords"] });
      navigate({ to: "/property-details/$propertyId", params: { propertyId: data as string } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't register the property");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Register a property</h1>
        {access!.officerCompanies.length > 1 ? (
          <select value={company.id} onChange={(e) => setPicked(e.target.value)} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
            {access!.officerCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : <p className="text-sm text-muted-foreground">{company.name}</p>}
      </div>

      <Section title="1. Property">
        <Field label="Property name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location"><input className={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Elgon View, Eldoret" /></Field>
          <Field label="Number of units"><input className={input} inputMode="numeric" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} /></Field>
        </div>
        <Field label="Description (optional)"><textarea className={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </Section>

      <Section title="2. Landlord" hint="The person or entity that genuinely owns this property.">
        <select className={input} value={landlordId} onChange={(e) => setLandlordId(e.target.value)}>
          <option value="new">+ New landlord</option>
          {(landlords ?? []).map((l) => <option key={l.id} value={l.id}>{l.full_name}{l.phone ? ` · ${l.phone}` : ""}</option>)}
        </select>
        {landlordId === "new" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name"><input className={input} value={llName} onChange={(e) => setLlName(e.target.value)} /></Field>
              <Field label="Phone"><input className={input} value={llPhone} onChange={(e) => setLlPhone(e.target.value)} placeholder="07…" /></Field>
            </div>
            <Field label="Email (optional)"><input className={input} type="email" value={llEmail} onChange={(e) => setLlEmail(e.target.value)} /></Field>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="mb-2 text-xs text-muted-foreground">Sensitive details are encrypted and hidden. Only Senior Officers (or staff they approve) can view them, and every view is logged.</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="National ID number"><input className={input} value={llId} onChange={(e) => setLlId(e.target.value)} /></Field>
                <Field label="KRA PIN"><input className={input} value={llKra} onChange={(e) => setLlKra(e.target.value)} /></Field>
              </div>
              <div className="mt-3"><Field label="Payout details (M-Pesa number or bank account)"><input className={input} value={llPayout} onChange={(e) => setLlPayout(e.target.value)} /></Field></div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>The landlord has agreed that {company.name} may store these details for managing their property.</span>
            </label>
          </>
        )}
      </Section>

      <Section title="3. Proof of ownership" hint="Required for every property. Only Senior Officers can open the document.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ownership type">
            <select className={input} value={ownType} onChange={(e) => setOwnType(e.target.value)}>
              {OWNERSHIP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Landlord's share (%)"><input className={input} inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} /></Field>
        </div>
        <Field label="Title deed / LR number"><input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ELDORET MUNICIPALITY/BLOCK 5/123" /></Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Ownership document (title deed or lease — photo or PDF)</span>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm font-medium hover:bg-muted">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : docPath ? <FileText className="h-4 w-4 text-green-700" /> : <Upload className="h-4 w-4" />}
            {docPath ? docName : "Upload document"}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Management agreement starts"><input className={input} type="date" value={agStart} onChange={(e) => setAgStart(e.target.value)} /></Field>
          <Field label="Agreement ends (optional)"><input className={input} type="date" value={agEnd} onChange={(e) => setAgEnd(e.target.value)} /></Field>
        </div>
      </Section>

      <Section title="4. Caretaker" hint="Their number is shown to all staff so viewings can be arranged.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Caretaker name"><input className={input} value={ctName} onChange={(e) => setCtName(e.target.value)} /></Field>
          <Field label="Caretaker phone"><input className={input} value={ctPhone} onChange={(e) => setCtPhone(e.target.value)} placeholder="07…" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date (optional)"><input className={input} type="date" value={ctStart} onChange={(e) => setCtStart(e.target.value)} /></Field>
          <Field label="Notes (optional)"><input className={input} value={ctNotes} onChange={(e) => setCtNotes(e.target.value)} /></Field>
        </div>
      </Section>

      <button onClick={submit} disabled={saving || uploading}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ background: "#166534" }}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Register property
      </button>
    </div>
  );
}
