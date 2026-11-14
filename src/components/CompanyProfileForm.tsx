import { useState } from "react";
import { Loader2 } from "lucide-react";

export type ProfileValues = Record<string, string>;

const input = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none";
const label = "mb-1 block text-xs font-medium text-muted-foreground";

// Fields only the NyumbaTrack owner can change (identity / contract details)
const OWNER_ONLY = new Set(["name", "registration_no", "registered_on", "kra_pin", "agreement_signed_on"]);

interface Field { key: string; label: string; type?: "text" | "date" | "number" | "email" | "tel"; required?: boolean; placeholder?: string; wide?: boolean }

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "The company", fields: [
    { key: "name", label: "Legal name", required: true, wide: true },
    { key: "trading_name", label: "Trading name (if different)", wide: true },
    { key: "registration_no", label: "Registration number", required: true },
    { key: "registered_on", label: "Date registered", type: "date" },
    { key: "kra_pin", label: "KRA PIN", required: true, placeholder: "A123456789B" },
    { key: "agreement_signed_on", label: "Service agreement signed", type: "date" },
  ] },
  { title: "Estate agent licence (EARB)", fields: [
    { key: "earb_no", label: "EARB licence number" },
    { key: "earb_expiry", label: "Licence expires", type: "date" },
  ] },
  { title: "Where and how to reach them", fields: [
    { key: "address", label: "Physical address", wide: true },
    { key: "town", label: "Town" },
    { key: "county", label: "County" },
    { key: "phone", label: "Company phone", type: "tel", required: true },
    { key: "email", label: "Company email", type: "email", required: true },
  ] },
  { title: "Main contact", fields: [
    { key: "contact_name", label: "Name", required: true },
    { key: "contact_phone", label: "Phone", type: "tel", required: true },
    { key: "contact_email", label: "Email", type: "email" },
    { key: "billing_contact", label: "Billing contact (if different)" },
  ] },
  { title: "About their business", fields: [
    { key: "expected_properties", label: "Properties they expect to manage", type: "number" },
    { key: "expected_units", label: "Units they expect to manage", type: "number" },
    { key: "odpc_reg_no", label: "Data protection (ODPC) registration number" },
  ] },
];

export function CompanyProfileForm({ initial, mode, submitLabel, onSubmit }: {
  initial: ProfileValues;
  /** owner-create / owner-edit show every field; company only the ones a company may change */
  mode: "owner-create" | "owner-edit" | "company";
  submitLabel: string;
  onSubmit: (values: ProfileValues) => Promise<void>;
}) {
  const [v, setV] = useState<ProfileValues>(initial);
  const [busy, setBusy] = useState(false);
  const create = mode === "owner-create";
  const company = mode === "company";

  const missing = create ? GROUPS.flatMap((g) => g.fields).filter((f) => f.required && !(v[f.key] ?? "").trim()) : [];

  const submit = async () => {
    setBusy(true);
    try {
      const out: ProfileValues = {};
      for (const g of GROUPS) for (const f of g.fields) {
        if (company && OWNER_ONLY.has(f.key)) continue;
        out[f.key] = v[f.key] ?? "";
      }
      await onSubmit(out);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => {
              const locked = company && OWNER_ONLY.has(f.key);
              return (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                  <label className={label}>{f.label}{create && f.required ? " *" : ""}</label>
                  <input
                    className={`${input} ${locked ? "bg-muted/50 text-muted-foreground" : ""}`}
                    type={f.type ?? "text"} inputMode={f.type === "number" ? "numeric" : undefined}
                    value={v[f.key] ?? ""} placeholder={f.placeholder} disabled={locked}
                    onChange={(e) => setV((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {company && <p className="text-xs text-muted-foreground">Legal name, registration number and KRA PIN can only be changed by NyumbaTrack. Contact us if they need correcting.</p>}
      <p className="text-xs text-muted-foreground">Contact details are used only for running this account: sign-in help, billing and service notices.</p>
      <button
        onClick={submit} disabled={busy || (create && missing.length > 0)}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--k-166534)" }}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {submitLabel}
      </button>
      {create && missing.length > 0 && <p className="text-xs text-amber-700">Still needed: {missing.map((f) => f.label).join(", ")}</p>}
    </div>
  );
}

export function profileToValues(p: Record<string, any> | null | undefined): ProfileValues {
  const out: ProfileValues = {};
  for (const g of GROUPS) for (const f of g.fields) out[f.key] = p?.[f.key] != null ? String(p[f.key]) : "";
  return out;
}
