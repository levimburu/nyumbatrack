import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Building2, MapPin, Key, Copy, Users, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useProperty } from "@/context/PropertyContext";
import { formatKES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/properties" as any)({
  component: PropertiesPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  total_units: number;
  created_at: string;
}

function PropertiesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedProperty } = useProperty();
  const [adding, setAdding] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isAgent, setIsAgent] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

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

  const { data: properties, isLoading } = useQuery({
    queryKey: ["properties", profileLoaded, isAgent],
    enabled: profileLoaded,
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
          .select("*")
          .in("user_id", landlordIds)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data as Property[];
      } else {
        const { data, error } = await (supabase as any)
          .from("properties")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data as Property[];
      }
    },
  });

  const { data: allTenants } = useQuery({
    queryKey: ["all-tenants-for-stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("property_id, rent_amount, balance");
      if (error) throw error;
      return data as any[];
    },
  });

  const addProperty = useMutation({
    mutationFn: async (p: { name: string; location: string; description: string; total_units: number }) => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("properties").insert({
        name: p.name,
        location: p.location || null,
        description: p.description || null,
        total_units: p.total_units ?? 0,
        user_id: u.id,
      });
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
    const { error } = await (supabase as any).from("invite_codes").insert({
      landlord_id: u.id,
      code,
    });
    if (error) { toast.error("Failed to generate code"); return; }
    setGeneratedCode(code);
    setShowInviteModal(true);
  };

  const openProperty = (property: Property) => {
    setSelectedProperty({ id: property.id, name: property.name, location: property.location });
    navigate({ to: "/dashboard" });
  };

  const getStats = (property: Property) => {
    const tenants = allTenants?.filter((t) => t.property_id === property.id) ?? [];
    const occupied = tenants.length;
    const totalUnits = property.total_units > 0 ? property.total_units : occupied;
    const vacant = Math.max(0, totalUnits - occupied);
    const monthlyRent = tenants.reduce((s, t) => s + Number(t.rent_amount), 0);
    const paid = tenants.filter((t) => Number(t.balance) === 0).length;
    const partial = tenants.filter((t) => Number(t.balance) > 0 && Number(t.balance) < Number(t.rent_amount)).length;
    const unpaid = tenants.filter((t) => Number(t.balance) >= Number(t.rent_amount)).length;
    const occupancyRate = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
    return { occupied, totalUnits, vacant, monthlyRent, paid, partial, unpaid, occupancyRate };
  };

  const renderContent = () => {
    if (!profileLoaded || isLoading) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-sm text-muted-foreground">Loading...</div>
        </div>
      );
    }

    if (!properties?.length) {
      return (
        <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
          <div className="mb-6">
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
              <Building2 className="h-10 w-10" style={{ color: "#166534" }} />
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              {isAgent ? "No properties assigned yet" : "Welcome to NyumbaTrack!"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
              {isAgent
                ? "Ask your landlord to assign you to a property."
                : "Let's get started by adding your first property."
              }
            </p>
          </div>
          {!isAgent && (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all glow-primary"
              style={{ background: "#166534" }}
            >
              <Plus className="h-5 w-5" /> Add your first property
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">My Properties</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {properties.length} {properties.length === 1 ? "property" : "properties"} managed
            </p>
          </div>
          {!isAgent && (
            <div className="flex gap-2">
              <button
                onClick={generateInviteCode}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Key className="h-4 w-4" /> Invite Agent
              </button>
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary"
                style={{ background: "#166534" }}
              >
                <Plus className="h-4 w-4" /> Add Property
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => {
            const stats = getStats(p);
            return (
              <div
                key={p.id}
                className="card-surface card-hover overflow-hidden cursor-pointer"
                onClick={() => openProperty(p)}
              >
                <div className="relative h-28 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #166534 0%, #15803d 100%)" }}>
                  {stats.occupancyRate > 0 && (
                    <div className="absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.25)" }}>
                      {stats.occupancyRate}% occupied
                    </div>
                  )}
                  {stats.totalUnits > 0 && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "#F59E0B", color: "#FFFFFF" }}>
                      <Users className="h-3 w-3" />
                      {stats.totalUnits} units
                    </div>
                  )}
                  <Building2 className="h-12 w-12 opacity-20 text-white" />
                </div>
                <div className="p-4">
                  <h3 className="font-display font-bold text-foreground">{p.name}</h3>
                  {p.location && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <MapPin className="h-3 w-3" />
                      {p.location}
                    </div>
                  )}
                  {stats.totalUnits > 0 && (
                    <>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div className="rounded-lg p-2.5" style={{ background: "#F5F5F0" }}>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                            <TrendingUp className="h-3 w-3" /> Monthly Rent
                          </div>
                          <div className="font-display font-bold text-sm text-foreground">{formatKES(stats.monthlyRent)}</div>
                        </div>
                        <div className="rounded-lg p-2.5" style={{ background: "#F5F5F0" }}>
                          <div className="text-xs text-muted-foreground mb-1">Occupied</div>
                          <div className="font-display font-bold text-sm text-foreground">{stats.occupied} / {stats.totalUnits}</div>
                        </div>
                        <div className="rounded-lg p-2.5" style={{ background: "#F5F5F0" }}>
                          <div className="text-xs text-muted-foreground mb-1">Vacant</div>
                          <div className="font-display font-bold text-sm text-foreground">{stats.vacant}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        {stats.paid > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "#DCFCE7", color: "#166534" }}>
                            {stats.paid} paid
                          </span>
                        )}
                        {stats.partial > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "#FEF9C3", color: "#854D0E" }}>
                            {stats.partial} partial
                          </span>
                        )}
                        {stats.unpaid > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                            {stats.unpaid} unpaid
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-end mt-3 text-xs font-medium" style={{ color: "#166534" }}>
                    View Dashboard →
                  </div>
                </div>
              </div>
            );
          })}

          {!isAgent && (
            <button
              onClick={() => setAdding(true)}
              className="card-surface flex flex-col items-center justify-center p-8 border-2 border-dashed hover:border-primary transition-colors min-h-[200px]"
              style={{ borderColor: "#D1D5DB" }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl mb-3" style={{ background: "#F0F0EB" }}>
                <Plus className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="font-medium text-sm text-foreground">Add New Property</div>
              <div className="text-xs text-muted-foreground mt-1">Register a property to get started</div>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderContent()}
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-6 animate-slide-up text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
          <Key className="h-7 w-7" style={{ color: "#166534" }} />
        </div>
        <h2 className="font-display text-xl font-semibold mb-2">Agent Invite Code</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Share this code with your agent. They'll use it when creating their account.
        </p>
        <div className="flex items-center justify-between rounded-xl border-2 px-4 py-3 mb-4" style={{ borderColor: "#166534", background: "#F0FDF4" }}>
          <span className="font-mono text-2xl font-bold tracking-widest" style={{ color: "#166534" }}>{code}</span>
          <button onClick={copyCode} className="text-muted-foreground hover:text-primary transition-colors">
            <Copy className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">This code can only be used once.</p>
        <button
          onClick={onClose}
          className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all"
          style={{ background: "#166534" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function PropertyForm({
  onSave, onClose, saving,
}: {
  onSave: (p: { name: string; location: string; description: string; total_units: number }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [totalUnits, setTotalUnits] = useState(0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Add property</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ name, location, description, total_units: totalUnits }); }} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Property name *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kindaruma Apartments" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Nairobi, Westlands" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Total Units</label>
            <input type="number" min={0} value={totalUnits} onChange={(e) => setTotalUnits(Number(e.target.value))} className="form-input" placeholder="e.g. 20" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any notes about this property..." rows={3} className="form-input resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-all glow-primary" style={{ background: "#166534" }}>
              {saving ? "Saving…" : "Save property"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>
  );
}