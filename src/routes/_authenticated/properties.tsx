import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Building2, MapPin, ChevronRight, Key, Copy } from "lucide-react";
import { toast } from "sonner";
import { useProperty } from "@/context/PropertyContext";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/properties")({
  component: PropertiesPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  created_at: string;
}

function PropertiesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedProperty } = useProperty();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  const { data: properties, isLoading } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any as Property[];
    },
  });

  const addProperty = useMutation({
    mutationFn: async (p: { name: string; location: string; description: string }) => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Not authenticated");
      const { error } = await supabase.from("properties").insert({
        name: p.name,
        location: p.location || null,
        description: p.description || null,
        user_id: u.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      setAdding(false);
      toast.success("Property added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateInviteCode = async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) return;

    const code = "NYM-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await supabase.from("invite_codes").insert({
      landlord_id: u.id,
      code,
    } as any);

    if (error) {
      toast.error("Failed to generate code");
      return;
    }

    setGeneratedCode(code);
    setShowInviteModal(true);
  };

  const openProperty = (property: Property) => {
    setSelectedProperty({ id: property.id, name: property.name, location: property.location });
    navigate({ to: "/dashboard" });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Welcome screen for new users
  if (!properties?.length) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
        <div className="mb-6">
          <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl bg-primary/10">
            <Building2 className="h-10 w-10 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">Welcome to NyumbaTrack!</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
            Let's get started by adding your first property.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-glow transition-colors glow-primary"
        >
          <Plus className="h-5 w-5" /> Add your first property
        </button>
        {adding && (
          <PropertyForm
            onSave={(p) => addProperty.mutate(p)}
            onClose={() => setAdding(false)}
            saving={addProperty.isPending}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">My Portfolio</div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Properties</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={generateInviteCode}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <Key className="h-4 w-4" /> Invite Agent
          </button>
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-glow transition-colors"
          >
            <Plus className="h-4 w-4" /> Add property
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {properties.map((p) => (
          <button
            key={p.id}
            onClick={() => openProperty(p)}
            className="card-surface card-hover w-full p-5 text-left flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <div className="font-display font-semibold text-foreground">{p.name}</div>
                {p.location && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="h-3 w-3" />
                    {p.location}
                  </div>
                )}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </button>
        ))}
      </div>

      {adding && (
        <PropertyForm
          onSave={(p) => addProperty.mutate(p)}
          onClose={() => setAdding(false)}
          saving={addProperty.isPending}
        />
      )}

      {showInviteModal && generatedCode && (
        <InviteCodeModal
          code={generatedCode}
          onClose={() => { setShowInviteModal(false); setGeneratedCode(null); }}
        />
      )}
    </div>
  );
}

function InviteCodeModal({ code, onClose }: { code: string; onClose: () => void }) {
  const copyCode = () => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied!");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-6 animate-slide-up text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
          <Key className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-display text-xl font-semibold mb-2">Agent Invite Code</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Share this code with your agent. They'll use it when creating their account.
        </p>
        <div className="flex items-center justify-between rounded-xl border-2 border-primary/20 bg-primary/5 px-4 py-3 mb-4">
          <span className="font-mono text-2xl font-bold text-primary tracking-widest">{code}</span>
          <button onClick={copyCode} className="text-muted-foreground hover:text-primary transition-colors">
            <Copy className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">This code can only be used once.</p>
        <button
          onClick={onClose}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-glow transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function PropertyForm({
  onSave,
  onClose,
  saving,
}: {
  onSave: (p: { name: string; location: string; description: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Add property</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSave({ name, location, description }); }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Property name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kindaruma Apartments"
              className="form-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Nairobi, Westlands"
              className="form-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any notes about this property..."
              rows={3}
              className="form-input resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="glow-primary rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-glow disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save property"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.5rem;border:1px solid var(--color-border);background:var(--color-card);padding:.5rem .75rem;font-size:.875rem;outline:none}.form-input:focus{border-color:var(--color-ring);box-shadow:0 0 0 3px rgba(37,99,235,0.12)}`}</style>
      </div>
    </div>
  );
}