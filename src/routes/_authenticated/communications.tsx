import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, MessageSquare, Building2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/communications")({
  component: CommunicationsPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface TenantMin {
  id: string;
  full_name: string;
  unit: string;
  property_id: string;
}

interface CommunicationEntry {
  id: string;
  property_id: string;
  tenant_id: string | null;
  tenant_name: string;
  type: string;
  note: string;
  created_by: string;
  created_at: string;
}

// Suggested starting points only, shown via <datalist> — free text underneath.
const COMMON_TYPES = ["Phone Call", "In-Person", "WhatsApp", "Written Notice"];

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function CommunicationsPage() {
  const qc = useQueryClient();
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CommunicationEntry | null>(null);

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

  // Same "properties I can see" logic as Maintenance/Compliance/Vendors.
  const { data: properties } = useQuery({
    queryKey: ["comms-properties", profileLoaded, isAgent],
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
  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? "Unknown property";

  // Minimal tenant list across every accessible property, just enough to
  // populate the "who is this about" dropdown.
  const { data: tenants } = useQuery({
    queryKey: ["comms-tenants", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, full_name, unit, property_id")
        .in("property_id", propertyIds)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as TenantMin[];
    },
  });

  const { data: entries, isLoading } = useQuery({
    queryKey: ["tenant-communications", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_communications")
        .select("*")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CommunicationEntry[];
    },
  });

  const createEntry = useMutation({
    mutationFn: async (e: { property_id: string; tenant_id: string; tenant_name: string; type: string; note: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("tenant_communications").insert({
        property_id: e.property_id,
        tenant_id: e.tenant_id || null,
        tenant_name: e.tenant_name,
        type: e.type,
        note: e.note,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-communications"] });
      setAdding(false);
      toast.success("Logged!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateEntry = useMutation({
    mutationFn: async (e: { id: string; type: string; note: string }) => {
      const { error } = await (supabase as any)
        .from("tenant_communications")
        .update({ type: e.type, note: e.note })
        .eq("id", e.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-communications"] });
      setEditing(null);
      toast.success("Updated!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("tenant_communications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-communications"] });
      toast.success("Removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
          <MessageSquare className="h-10 w-10" style={{ color: "#166534" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Add a property first to start logging tenant communications.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Tenant Communications</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {entries?.length ?? 0} {entries?.length === 1 ? "entry" : "entries"} across {properties.length} {properties.length === 1 ? "property" : "properties"}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          disabled={!tenants?.length}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary disabled:opacity-50"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Log Communication
        </button>
      </div>

      {!tenants?.length && (
        <div className="card-surface p-4 text-sm text-muted-foreground">
          No tenants found yet across your properties — add a tenant first before logging a communication.
        </div>
      )}

      <div className="space-y-3">
        {(!entries || entries.length === 0) && (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            No communications logged yet.
          </div>
        )}
        {entries?.map((e) => (
          <div key={e.id} className="card-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-foreground truncate">{e.tenant_name}</h3>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0"
                    style={{ background: "#EFF6FF", color: "#2563EB" }}
                  >
                    {e.type}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {propertyName(e.property_id)} · {formatWhen(e.created_at)}
                </div>
                <p className="text-sm text-muted-foreground mt-2">{e.note}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setEditing(e)} className="text-muted-foreground hover:text-foreground" aria-label="Edit entry">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => deleteEntry.mutate(e.id)} className="text-muted-foreground hover:text-red-600" aria-label="Remove entry">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <CommunicationForm
          properties={properties}
          tenants={tenants ?? []}
          onSave={(e) => createEntry.mutate(e)}
          onClose={() => setAdding(false)}
          saving={createEntry.isPending}
        />
      )}
      {editing && (
        <EditNoteForm
          entry={editing}
          onSave={(e) => updateEntry.mutate(e)}
          onClose={() => setEditing(null)}
          saving={updateEntry.isPending}
        />
      )}
    </div>
  );
}

function CommunicationForm({
  properties, tenants, onSave, onClose, saving,
}: {
  properties: Property[];
  tenants: TenantMin[];
  onSave: (e: { property_id: string; tenant_id: string; tenant_name: string; type: string; note: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const tenantsForProperty = tenants.filter((t) => t.property_id === propertyId);
  const [tenantId, setTenantId] = useState(tenantsForProperty[0]?.id ?? "");
  const [type, setType] = useState("");
  const [note, setNote] = useState("");

  // Keep the tenant selection valid whenever the property changes.
  const handlePropertyChange = (id: string) => {
    setPropertyId(id);
    const first = tenants.find((t) => t.property_id === id);
    setTenantId(first?.id ?? "");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) {
      toast.error("Select a property");
      return;
    }
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      toast.error("Select a tenant");
      return;
    }
    if (!type.trim()) {
      toast.error("Enter a type (e.g. Phone Call)");
      return;
    }
    if (!note.trim()) {
      toast.error("Enter a note about what was discussed");
      return;
    }
    onSave({
      property_id: propertyId,
      tenant_id: tenant.id,
      tenant_name: tenant.full_name,
      type: type.trim(),
      note: note.trim(),
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Log Communication</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Property *</label>
            <select required value={propertyId} onChange={(e) => handlePropertyChange(e.target.value)} className="form-input">
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Tenant *</label>
            <select required value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="form-input">
              {tenantsForProperty.length === 0 && <option value="">No tenants for this property</option>}
              {tenantsForProperty.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name} — Unit {t.unit}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Type *</label>
            <input
              required
              list="comm-types"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. Phone Call"
              className="form-input"
            />
            <datalist id="comm-types">
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Note *</label>
            <textarea required value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed..." rows={4} className="form-input resize-none" />
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

function EditNoteForm({
  entry, onSave, onClose, saving,
}: {
  entry: CommunicationEntry;
  onSave: (e: { id: string; type: string; note: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [type, setType] = useState(entry.type);
  const [note, setNote] = useState(entry.note);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!type.trim()) {
      toast.error("Enter a type");
      return;
    }
    if (!note.trim()) {
      toast.error("Enter a note");
      return;
    }
    onSave({ id: entry.id, type: type.trim(), note: note.trim() });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Edit Entry — {entry.tenant_name}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Type *</label>
            <input
              required
              list="comm-types-edit"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="form-input"
            />
            <datalist id="comm-types-edit">
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Note *</label>
            <textarea required value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="form-input resize-none" />
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