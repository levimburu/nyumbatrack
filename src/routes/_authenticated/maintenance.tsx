import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Wrench, Building2, Clock, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/maintenance")({
  component: MaintenancePage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface Vendor {
  id: string;
  name: string;
  trade: string | null;
}

type TicketStatus = "open" | "in_progress" | "done";

interface Ticket {
  id: string;
  property_id: string;
  unit: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  assigned_to: string | null;
  vendor_id: string | null;
  cost: number | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

function statusLabel(s: TicketStatus) {
  if (s === "open") return "Open";
  if (s === "in_progress") return "In Progress";
  return "Done";
}

function statusColor(s: TicketStatus) {
  if (s === "open") return { bg: "#FEE2E2", text: "#DC2626" };
  if (s === "in_progress") return { bg: "#FEF3C7", text: "#D97706" };
  return { bg: "#DCFCE7", text: "#16A34A" };
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const c = statusColor(status);
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0" style={{ background: c.bg, color: c.text }}>
      {statusLabel(status)}
    </span>
  );
}

function MaintenancePage() {
  const qc = useQueryClient();
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");

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

  // Same "properties I can see" logic as the Properties page: own properties
  // for a landlord, or every property belonging to a linked landlord for an
  // agent/PM (agent_landlord already supports being linked to more than one).
  const { data: properties } = useQuery({
    queryKey: ["maintenance-properties", profileLoaded, isAgent],
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

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["maintenance-tickets", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_tickets")
        .select("*")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Ticket[];
    },
  });

  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? "Unknown property";

  // RLS scopes this to vendors created by me or by someone linked to me,
  // same as the vendors directory page itself.
  const { data: vendors } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vendors")
        .select("id, name, trade")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const vendorName = (id: string | null) => vendors?.find((v) => v.id === id)?.name ?? null;

  const createTicket = useMutation({
    mutationFn: async (t: { property_id: string; unit: string; title: string; description: string; vendor_id: string; cost: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("maintenance_tickets").insert({
        property_id: t.property_id,
        unit: t.unit || null,
        title: t.title,
        description: t.description || null,
        vendor_id: t.vendor_id || null,
        cost: t.cost ? Number(t.cost) : null,
        created_by: user.id,
        status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      setAdding(false);
      toast.success("Ticket logged!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TicketStatus }) => {
      const { error } = await (supabase as any)
        .from("maintenance_tickets")
        .update({
          status,
          completed_at: status === "done" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTicket = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("maintenance_tickets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      toast.success("Ticket removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredTickets = (tickets ?? []).filter((t) => statusFilter === "all" || t.status === statusFilter);

  const counts = {
    open: (tickets ?? []).filter((t) => t.status === "open").length,
    in_progress: (tickets ?? []).filter((t) => t.status === "in_progress").length,
    done: (tickets ?? []).filter((t) => t.status === "done").length,
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
          <Wrench className="h-10 w-10" style={{ color: "#166534" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Add a property first to start logging maintenance tickets.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Maintenance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tickets?.length ?? 0} {tickets?.length === 1 ? "ticket" : "tickets"} across {properties.length} {properties.length === 1 ? "property" : "properties"}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Log Ticket
        </button>
      </div>

      {/* Status summary — also doubles as a filter; tap a card to filter, tap again to clear. */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setStatusFilter(statusFilter === "open" ? "all" : "open")}
          className="card-surface p-4 text-left transition-all"
          style={{ boxShadow: statusFilter === "open" ? "0 0 0 2px #DC2626" : undefined }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#FEE2E2" }}>
              <Circle className="h-4 w-4" style={{ color: "#DC2626" }} />
            </div>
            <span className="text-xs text-muted-foreground">Open</span>
          </div>
          <div className="font-display text-xl font-bold" style={{ color: "#DC2626" }}>{counts.open}</div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "in_progress" ? "all" : "in_progress")}
          className="card-surface p-4 text-left transition-all"
          style={{ boxShadow: statusFilter === "in_progress" ? "0 0 0 2px #D97706" : undefined }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#FEF3C7" }}>
              <Clock className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
            <span className="text-xs text-muted-foreground">In Progress</span>
          </div>
          <div className="font-display text-xl font-bold" style={{ color: "#D97706" }}>{counts.in_progress}</div>
        </button>

        <button
          onClick={() => setStatusFilter(statusFilter === "done" ? "all" : "done")}
          className="card-surface p-4 text-left transition-all"
          style={{ boxShadow: statusFilter === "done" ? "0 0 0 2px #16A34A" : undefined }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#DCFCE7" }}>
              <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />
            </div>
            <span className="text-xs text-muted-foreground">Done</span>
          </div>
          <div className="font-display text-xl font-bold" style={{ color: "#16A34A" }}>{counts.done}</div>
        </button>
      </div>

      {/* Ticket list */}
      <div className="space-y-3">
        {filteredTickets.length === 0 && (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            No tickets {statusFilter !== "all" ? `marked "${statusLabel(statusFilter as TicketStatus)}"` : "yet"}.
          </div>
        )}
        {filteredTickets.map((t) => (
          <div key={t.id} className="card-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-foreground truncate">{t.title}</h3>
                  <StatusBadge status={t.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {propertyName(t.property_id)}{t.unit ? ` · Unit ${t.unit}` : " · Property-wide"}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Logged {new Date(t.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} at {new Date(t.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </div>
                {t.description && (
                  <p className="text-sm text-muted-foreground mt-2">{t.description}</p>
                )}
                {(vendorName(t.vendor_id) || t.assigned_to) && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Assigned to: <span className="font-medium text-foreground">{vendorName(t.vendor_id) ?? t.assigned_to}</span>
                  </div>
                )}
                {t.cost != null && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Cost: <span className="font-medium text-foreground">KES {Number(t.cost).toLocaleString()}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => deleteTicket.mutate(t.id)}
                className="text-xs text-muted-foreground hover:text-red-600 flex-shrink-0"
                aria-label="Remove ticket"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-3">
              {(["open", "in_progress", "done"] as TicketStatus[]).map((s) => {
                const c = statusColor(s);
                const active = t.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => updateStatus.mutate({ id: t.id, status: s })}
                    disabled={active}
                    className="rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default"
                    style={{
                      background: active ? c.bg : "#F5F5F0",
                      color: active ? c.text : "#6B7280",
                    }}
                  >
                    {statusLabel(s)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <TicketForm
          properties={properties}
          vendors={vendors ?? []}
          onSave={(t) => createTicket.mutate(t)}
          onClose={() => setAdding(false)}
          saving={createTicket.isPending}
        />
      )}
    </div>
  );
}

function TicketForm({
  properties, vendors, onSave, onClose, saving,
}: {
  properties: Property[];
  vendors: Vendor[];
  onSave: (t: { property_id: string; unit: string; title: string; description: string; vendor_id: string; cost: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [unit, setUnit] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [cost, setCost] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) {
      toast.error("Select a property");
      return;
    }
    if (!title.trim()) {
      toast.error("Enter a title for the ticket");
      return;
    }
    onSave({
      property_id: propertyId,
      unit: unit.trim(),
      title: title.trim(),
      description: description.trim(),
      vendor_id: vendorId,
      cost,
    });
  };

  // Same createPortal pattern as PropertyForm — keeps this modal immune to
  // the page's animated <main> wrapper breaking position:fixed.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Log Maintenance Ticket</h2>
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
            <label className="mb-1.5 block text-xs font-medium text-foreground">Unit (optional)</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 3A — leave blank if property-wide" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Title *</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leaking tap" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any extra detail..." rows={3} className="form-input resize-none" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Assigned to (optional)</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="form-input">
              <option value="">— Unassigned —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.trade ? ` (${v.trade})` : ""}</option>
              ))}
            </select>
            {vendors.length === 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                You haven't added any vendors yet — add one from the Vendors page to assign tickets to them.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Cost (KES) — optional</label>
            <input
              type="number"
              min={0}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="e.g. 2500 — leave blank if unknown yet"
              className="form-input"
            />
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