import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, ShieldCheck, Building2, AlertTriangle, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/compliance")({
  component: CompliancePage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface ComplianceRecord {
  id: string;
  property_id: string;
  type: string;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string;
  notes: string | null;
  created_by: string;
  created_at: string;
}

type ComplianceStatus = "valid" | "expiring_soon" | "expired";

// Status is never stored — it's always derived fresh from expiry_date vs
// today, so it never goes stale the way a manually-set field would.
function getStatus(expiryDate: string): ComplianceStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  const diffDays = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "expiring_soon";
  return "valid";
}

function statusLabel(s: ComplianceStatus) {
  if (s === "valid") return "Valid";
  if (s === "expiring_soon") return "Expiring Soon";
  return "Expired";
}

function statusColor(s: ComplianceStatus) {
  if (s === "valid") return { bg: "#DCFCE7", text: "#16A34A" };
  if (s === "expiring_soon") return { bg: "#FEF3C7", text: "#D97706" };
  return { bg: "#FEE2E2", text: "#DC2626" };
}

function StatusBadge({ status }: { status: ComplianceStatus }) {
  const c = statusColor(status);
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0" style={{ background: c.bg, color: c.text }}>
      {statusLabel(status)}
    </span>
  );
}

// Suggested starting points only — shown via <datalist> so the field stays
// free text, since requirements genuinely vary by county.
const COMMON_TYPES = [
  "Single Business Permit",
  "Fire Safety Certificate",
  "Occupation Certificate",
  "NCA Completion Certificate",
  "Land Rates Clearance Certificate",
  "KRA Tax Compliance Certificate",
];

function CompliancePage() {
  const qc = useQueryClient();
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ComplianceRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ComplianceStatus>("all");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAgent(data?.role === "agent");
      setProfileLoaded(true);
    });
  }, []);

  // Same "properties I can see" logic as Maintenance/Properties.
  const { data: properties } = useQuery({
    queryKey: ["compliance-properties", profileLoaded, isAgent],
    enabled: profileLoaded && isAgent !== null,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (isAgent) {
        const { data: agentLinks } = await (supabase as any)
          .from("agent_landlord")
          .select("landlord_id")
          .eq("agent_id", user.id);
        if (!agentLinks?.length) return [] as Property[];
        const landlordIds = agentLinks.map((l: any) => l.landlord_id);
        const { data, error } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id")
          .in("user_id", landlordIds)
          .order("name", { ascending: true });
        if (error) throw error;
        return data as Property[];
      } else {
        const { data, error } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id")
          .eq("user_id", user.id)
          .order("name", { ascending: true });
        if (error) throw error;
        return data as Property[];
      }
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);

  const { data: records, isLoading } = useQuery({
    queryKey: ["compliance-records", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compliance_records")
        .select("*")
        .in("property_id", propertyIds)
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      return data as ComplianceRecord[];
    },
  });

  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? "Unknown property";

  const createRecord = useMutation({
    mutationFn: async (r: { property_id: string; type: string; document_number: string; issue_date: string; expiry_date: string; notes: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("compliance_records").insert({
        property_id: r.property_id,
        type: r.type,
        document_number: r.document_number || null,
        issue_date: r.issue_date || null,
        expiry_date: r.expiry_date,
        notes: r.notes || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-records"] });
      setAdding(false);
      toast.success("Compliance record added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRecord = useMutation({
    mutationFn: async (r: { id: string; property_id: string; type: string; document_number: string; issue_date: string; expiry_date: string; notes: string }) => {
      const { error } = await (supabase as any)
        .from("compliance_records")
        .update({
          property_id: r.property_id,
          type: r.type,
          document_number: r.document_number || null,
          issue_date: r.issue_date || null,
          expiry_date: r.expiry_date,
          notes: r.notes || null,
        })
        .eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-records"] });
      setEditing(null);
      toast.success("Compliance record updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRecord = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("compliance_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compliance-records"] });
      toast.success("Record removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordsWithStatus = (records ?? []).map((r) => ({ ...r, status: getStatus(r.expiry_date) }));
  const filteredRecords = recordsWithStatus.filter((r) => statusFilter === "all" || r.status === statusFilter);

  const counts = {
    valid: recordsWithStatus.filter((r) => r.status === "valid").length,
    expiring_soon: recordsWithStatus.filter((r) => r.status === "expiring_soon").length,
    expired: recordsWithStatus.filter((r) => r.status === "expired").length,
  };

  if (!profileLoaded || isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!properties?.length) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
          <ShieldCheck className="h-10 w-10" style={{ color: "#166534" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Add a property first to start tracking compliance records.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Compliance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {records?.length ?? 0} {records?.length === 1 ? "record" : "records"} across {properties.length} {properties.length === 1 ? "property" : "properties"}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Add Record
        </button>
      </div>

      {/* Status summary — also doubles as a filter; tap to filter, tap again to clear. */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setStatusFilter(statusFilter === "valid" ? "all" : "valid")}
          className="card-surface p-4 text-left transition-all"
          style={{ boxShadow: statusFilter === "valid" ? "0 0 0 2px #16A34A" : undefined }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#DCFCE7" }}>
              <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />
            </div>
            <span className="text-xs text-muted-foreground">Valid</span>
          </div>
          <div className="font-display text-xl font-bold" style={{ color: "#16A34A" }}>{counts.valid}</div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "expiring_soon" ? "all" : "expiring_soon")}
          className="card-surface p-4 text-left transition-all"
          style={{ boxShadow: statusFilter === "expiring_soon" ? "0 0 0 2px #D97706" : undefined }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#FEF3C7" }}>
              <AlertTriangle className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
            <span className="text-xs text-muted-foreground">Expiring Soon</span>
          </div>
          <div className="font-display text-xl font-bold" style={{ color: "#D97706" }}>{counts.expiring_soon}</div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "expired" ? "all" : "expired")}
          className="card-surface p-4 text-left transition-all"
          style={{ boxShadow: statusFilter === "expired" ? "0 0 0 2px #DC2626" : undefined }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#FEE2E2" }}>
              <AlertTriangle className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
            <span className="text-xs text-muted-foreground">Expired</span>
          </div>
          <div className="font-display text-xl font-bold" style={{ color: "#DC2626" }}>{counts.expired}</div>
        </button>
      </div>

      {/* Records list */}
      <div className="space-y-3">
        {filteredRecords.length === 0 && (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            No records {statusFilter !== "all" ? `marked "${statusLabel(statusFilter as ComplianceStatus)}"` : "yet"}.
          </div>
        )}
        {filteredRecords.map((r) => (
          <div key={r.id} className="card-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-foreground truncate">{r.type}</h3>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {propertyName(r.property_id)}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Expires: <span className="font-medium text-foreground">{r.expiry_date}</span>
                  {r.issue_date && <span> · Issued: {r.issue_date}</span>}
                </div>
                {r.document_number && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Document #: <span className="font-medium text-foreground">{r.document_number}</span>
                  </div>
                )}
                {r.notes && (
                  <p className="text-sm text-muted-foreground mt-2">{r.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setEditing(r)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Edit record"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => deleteRecord.mutate(r.id)}
                  className="text-muted-foreground hover:text-red-600"
                  aria-label="Remove record"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <ComplianceForm
          properties={properties}
          onSave={(r) => createRecord.mutate(r)}
          onClose={() => setAdding(false)}
          saving={createRecord.isPending}
        />
      )}
      {editing && (
        <ComplianceForm
          properties={properties}
          initial={editing}
          onSave={(r) => updateRecord.mutate({ id: editing.id, ...r })}
          onClose={() => setEditing(null)}
          saving={updateRecord.isPending}
        />
      )}
    </div>
  );
}

function ComplianceForm({
  properties, initial, onSave, onClose, saving,
}: {
  properties: Property[];
  initial?: ComplianceRecord;
  onSave: (r: { property_id: string; type: string; document_number: string; issue_date: string; expiry_date: string; notes: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [propertyId, setPropertyId] = useState(initial?.property_id ?? properties[0]?.id ?? "");
  const [type, setType] = useState(initial?.type ?? "");
  const [documentNumber, setDocumentNumber] = useState(initial?.document_number ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(initial?.expiry_date ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) {
      toast.error("Select a property");
      return;
    }
    if (!type.trim()) {
      toast.error("Enter what this record is (e.g. Fire Safety Certificate)");
      return;
    }
    if (!expiryDate) {
      toast.error("Enter an expiry date");
      return;
    }
    onSave({
      property_id: propertyId,
      type: type.trim(),
      document_number: documentNumber.trim(),
      issue_date: issueDate,
      expiry_date: expiryDate,
      notes: notes.trim(),
    });
  };

  // Same createPortal pattern as the other forms in this app.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? "Edit Compliance Record" : "Add Compliance Record"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Property *</label>
            <select required value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="form-input">
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Type *</label>
            <input
              required
              list="compliance-types"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. Fire Safety Certificate"
              className="form-input"
            />
            <datalist id="compliance-types">
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Document / Reference Number (optional)</label>
            <input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="e.g. permit or certificate number" className="form-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Issue Date (optional)</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Expiry Date *</label>
              <input required type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="form-input" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra detail..." rows={3} className="form-input resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-all glow-primary" style={{ background: "#166534" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>,
    document.body
  );
}