import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Phone, Mail, Pencil, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendors")({
  component: VendorsPage,
});

export interface Vendor {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

const COMMON_TRADES = [
  "Plumbing",
  "Electrical",
  "Security",
  "Cleaning",
  "Carpentry",
  "Painting",
  "General Maintenance",
];

function VendorsPage() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  // RLS already scopes this to "created by me, or by someone linked to me
  // via agent_landlord" — no need to replicate that join client-side.
  const { data: vendors, isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vendors")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const createVendor = useMutation({
    mutationFn: async (v: { name: string; trade: string; phone: string; email: string; notes: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("vendors").insert({
        name: v.name,
        trade: v.trade || null,
        phone: v.phone || null,
        email: v.email || null,
        notes: v.notes || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setAdding(false);
      toast.success("Vendor added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateVendor = useMutation({
    mutationFn: async (v: { id: string; name: string; trade: string; phone: string; email: string; notes: string }) => {
      const { error } = await (supabase as any)
        .from("vendors")
        .update({
          name: v.name,
          trade: v.trade || null,
          phone: v.phone || null,
          email: v.email || null,
          notes: v.notes || null,
        })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setEditing(null);
      toast.success("Vendor updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteVendor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("vendors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {vendors?.length ?? 0} {vendors?.length === 1 ? "vendor" : "vendors"} in your contact book
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Add Vendor
        </button>
      </div>

      {!vendors?.length ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
          <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
            <Users className="h-10 w-10" style={{ color: "#166534" }} />
          </div>
          <h2 className="font-display text-xl font-bold text-foreground">No vendors yet</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs">
            Add the plumbers, electricians, and other contractors you actually work with — they'll show up as
            options when assigning a maintenance ticket.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => (
            <div key={v.id} className="card-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-foreground truncate">{v.name}</h3>
                  {v.trade && (
                    <span
                      className="inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: "#EFF6FF", color: "#2563EB" }}
                    >
                      {v.trade}
                    </span>
                  )}
                </div>
                {v.created_by === userId && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => setEditing(v)} className="text-muted-foreground hover:text-foreground" aria-label="Edit vendor">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => deleteVendor.mutate(v.id)} className="text-muted-foreground hover:text-red-600" aria-label="Remove vendor">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1.5">
                {v.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" /> {v.phone}
                  </div>
                )}
                {v.email && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" /> {v.email}
                  </div>
                )}
              </div>
              {v.notes && <p className="text-sm text-muted-foreground mt-2">{v.notes}</p>}
              {v.created_by !== userId && (
                <div className="text-[10px] text-muted-foreground mt-2 uppercase tracking-wide">Shared by a linked account</div>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <VendorForm
          onSave={(v) => createVendor.mutate(v)}
          onClose={() => setAdding(false)}
          saving={createVendor.isPending}
        />
      )}
      {editing && (
        <VendorForm
          initial={editing}
          onSave={(v) => updateVendor.mutate({ id: editing.id, ...v })}
          onClose={() => setEditing(null)}
          saving={updateVendor.isPending}
        />
      )}
    </div>
  );
}

function VendorForm({
  initial, onSave, onClose, saving,
}: {
  initial?: Vendor;
  onSave: (v: { name: string; trade: string; phone: string; email: string; notes: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [trade, setTrade] = useState(initial?.trade ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a name");
      return;
    }
    onSave({
      name: name.trim(),
      trade: trade.trim(),
      phone: phone.trim(),
      email: email.trim(),
      notes: notes.trim(),
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? "Edit Vendor" : "Add Vendor"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Name *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mike the Plumber" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Trade / Specialty (optional)</label>
            <input
              list="vendor-trades"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder="e.g. Plumbing"
              className="form-input"
            />
            <datalist id="vendor-trades">
              {COMMON_TRADES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0714380973" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Email (optional)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. mike@example.com" className="form-input" />
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