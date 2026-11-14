import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { fetchManagedProperties } from "@/lib/managedProperties";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Building2, MapPin, Users, TrendingUp, Pencil, Wallet, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProperty } from "@/context/PropertyContext";
import { formatKES, formatKESCompact } from "@/lib/format";
import type { PaymentMethod } from "@/lib/reminders";
import { PhotoCropper } from "@/components/PhotoCropper";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export const Route = createFileRoute("/_authenticated/properties")({
  component: PropertiesPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  total_units: number;
  created_at: string;
  user_id: string;
  payment_method: PaymentMethod | null;
  payment_number: string | null;
  payment_account: string | null;
  photo_url: string | null;
}

/** What the property form collects and hands to the add/edit mutations. */
interface PropertyFormValues {
  name: string;
  location: string;
  description: string;
  total_units: number;
  payment_method: PaymentMethod | null;
  payment_number: string | null;
  payment_account: string | null;
  photo_url: string | null;
}

function PropertiesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: companyAccess } = useCompanyAccess();
  const isCompanyOfficer = (companyAccess?.officerCompanies.length ?? 0) > 0;
  const { setSelectedProperty } = useProperty();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .maybeSingle();
      setIsAgent(data?.role === "agent");
      setFullName(data?.full_name ?? "");
      setProfileLoaded(true);
    });
  }, []);

  const { data: properties, isLoading } = useQuery({
    queryKey: ["properties", profileLoaded, isAgent],
    enabled: profileLoaded && isAgent !== null,
    queryFn: async () => {
      return (await fetchManagedProperties("*", { column: "created_at", ascending: true })) as Property[];
    },
  });

  // Only needed for an agent/PM viewing multiple landlords' properties —
  // resolves each property's user_id into an actual name to show on its card.
  const ownerIds = Array.from(new Set((properties ?? []).map((p) => p.user_id)));
  const { data: owners } = useQuery({
    queryKey: ["property-owners", ownerIds.join(",")],
    enabled: !!isAgent && ownerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ownerIds);
      if (error) throw error;
      return data as { id: string; full_name: string | null; email: string | null }[];
    },
  });
  const ownerName = (userId: string) => {
    const o = owners?.find((x) => x.id === userId);
    return o?.full_name || o?.email || "Unknown owner";
  };

  const { data: allTenants } = useQuery({
    queryKey: ["all-tenants-for-stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, property_id, rent_amount, balance, next_due_date");
      if (error) throw error;
      return data as any[];
    },
  });

  // Payments made FOR the current month, used to compute paid/partial/unpaid per property
  const currentMonthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const { data: monthPayments } = useQuery({
    queryKey: ["all-payments-current-month", currentMonthLabel],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("amount, tenant_id, payment_month")
        .eq("payment_month", currentMonthLabel);
      if (error) throw error;
      return data as any[];
    },
  });

  const addProperty = useMutation({
    mutationFn: async (p: PropertyFormValues) => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("properties").insert({
        name: p.name,
        location: p.location || null,
        description: p.description || null,
        total_units: p.total_units ?? 0,
        user_id: u.id,
        payment_method: p.payment_method,
        payment_number: p.payment_number,
        payment_account: p.payment_account,
        photo_url: p.photo_url,
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

  const editProperty = useMutation({
    mutationFn: async (p: PropertyFormValues & { id: string }) => {
      const { error } = await (supabase as any).from("properties").update({
        name: p.name,
        location: p.location || null,
        description: p.description || null,
        total_units: p.total_units ?? 0,
        payment_method: p.payment_method,
        payment_number: p.payment_number,
        payment_account: p.payment_account,
        photo_url: p.photo_url,
      }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      // The reminder button reads this via its own query key, keyed by
      // property id — without this, an edit here wouldn't show up on the
      // Tenants/Payments pages until something else invalidated it.
      qc.invalidateQueries({ queryKey: ["property-payment-details"] });
      qc.invalidateQueries({ queryKey: ["property-detail"] });
      setEditing(null);
      toast.success("Property updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

    // How much each tenant has paid FOR the current month (by payment_month)
    const paidByTenant: Record<string, number> = {};
    (monthPayments ?? []).forEach((p) => {
      paidByTenant[p.tenant_id] = (paidByTenant[p.tenant_id] ?? 0) + Number(p.amount);
    });

    // A tenant is covered by advance when their next_due_date is in a later
    // month than the current one (rent already settled through this month).
    const now = new Date();
    const currentYM = now.getFullYear() * 12 + now.getMonth();
    const coveredByAdvance = (t: any): boolean => {
      if (!t.next_due_date) return false;
      const due = new Date(t.next_due_date);
      if (isNaN(due.getTime())) return false;
      return due.getFullYear() * 12 + due.getMonth() > currentYM;
    };

    // Total collected this month: payments tagged for this month, plus the full
    // rent of advance-covered tenants who have no payment tagged to this month.
    const tenantIds = new Set(tenants.map((t) => t.id));
    const collectedFromPayments = (monthPayments ?? [])
      .filter((p) => tenantIds.has(p.tenant_id))
      .reduce((s, p) => s + Number(p.amount), 0);
    const collectedFromAdvance = tenants.reduce((s, t) => {
      if (coveredByAdvance(t) && !((paidByTenant[t.id] ?? 0) > 0)) {
        return s + Number(t.rent_amount);
      }
      return s;
    }, 0);
    const collectedThisMonth = collectedFromPayments + collectedFromAdvance;

    let paid = 0, partial = 0, unpaid = 0;
    tenants.forEach((t) => {
      const paidAmt = paidByTenant[t.id] ?? 0;
      const rent = Number(t.rent_amount);
      if (coveredByAdvance(t)) paid++;
      else if (rent > 0 && paidAmt >= rent) paid++;
      else if (paidAmt > 0) partial++;
      else unpaid++;
    });

    const occupancyRate = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
    return { occupied, totalUnits, vacant, monthlyRent, collectedThisMonth, paid, partial, unpaid, occupancyRate };
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
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "var(--k-DCFCE7)" }}>
              <Building2 className="h-10 w-10" style={{ color: "var(--kt-166534)" }} />
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
              onClick={() => (isCompanyOfficer ? navigate({ to: "/register-property" }) : setAdding(true))}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all glow-primary"
              style={{ background: "var(--k-166534)" }}
            >
              <Plus className="h-5 w-5" /> Add your first property
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm md:hidden">
              <span className="font-semibold text-foreground">{getGreeting()}, {(fullName || "there").split(" ")[0]}</span>
              <span className="text-muted-foreground">· {getTodayDate()}</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-display text-2xl font-bold text-foreground">My Properties</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {properties.length} {properties.length === 1 ? "property" : "properties"} managed
                </p>
              </div>
              <img src="/icon-512.png" alt="NyumbaTrack" className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl" style={{ background: "var(--k-0D2818)" }} />
            </div>
            {!isAgent && (
              <div className="flex gap-2">
                <button
                  onClick={() => (isCompanyOfficer ? navigate({ to: "/register-property" }) : setAdding(true))}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary"
                  style={{ background: "var(--k-166534)" }}
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
                <div className="relative h-28 flex items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, var(--k-166534) 0%, var(--k-15803D) 100%)" }}>
                  {p.photo_url && (
                    <>
                      <img src={p.photo_url} alt={p.name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 55%)" }} />
                    </>
                  )}
                  {stats.occupancyRate > 0 && (
                    <div className="absolute top-3 right-3 z-10 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.25)" }}>
                      {stats.occupancyRate}% occupied
                    </div>
                  )}
                  {stats.totalUnits > 0 && (
                    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "var(--k-F59E0B)", color: "var(--kt-FFFFFF)" }}>
                      <Users className="h-3 w-3" />
                      {stats.totalUnits} units
                    </div>
                  )}
                  {!p.photo_url && <Building2 className="h-12 w-12 opacity-20 text-white" />}
                </div>
                <div className="p-4">
                  <h3 className="font-display font-bold text-foreground">{p.name}</h3>
                  {p.location && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <MapPin className="h-3 w-3" />
                      {p.location}
                    </div>
                  )}
                  {isAgent && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <Users className="h-3 w-3" />
                      Owner: <span className="font-medium text-foreground">{ownerName(p.user_id)}</span>
                    </div>
                  )}
                  {stats.totalUnits > 0 && (
                    <>
                      <div className="mt-3 space-y-2">
                        <div className="rounded-lg p-2.5" style={{ background: "var(--k-F5F5F0)" }}>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                            <TrendingUp className="h-3 w-3" /> Collected
                          </div>
                          <div className="font-display font-bold text-base" style={{ color: "var(--kt-16A34A)" }}>{formatKES(stats.collectedThisMonth)}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg p-2.5" style={{ background: "var(--k-F5F5F0)" }}>
                            <div className="text-xs text-muted-foreground mb-1">Occupied</div>
                            <div className="font-display font-bold text-sm text-foreground">{stats.occupied} / {stats.totalUnits}</div>
                          </div>
                          <div className="rounded-lg p-2.5" style={{ background: "var(--k-F5F5F0)" }}>
                            <div className="text-xs text-muted-foreground mb-1">Vacant</div>
                            <div className="font-display font-bold text-sm" style={{ color: stats.vacant > 0 ? "var(--kt-DC2626)" : "var(--kt-16A34A)" }}>{stats.vacant}</div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        {stats.paid > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "var(--k-DCFCE7)", color: "var(--kt-166534)" }}>
                            {stats.paid} paid
                          </span>
                        )}
                        {stats.partial > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "var(--k-FEF9C3)", color: "var(--kt-854D0E)" }}>
                            {stats.partial} partial
                          </span>
                        )}
                        {stats.unpaid > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: "var(--k-FEE2E2)", color: "var(--kt-991B1B)" }}>
                            {stats.unpaid} unpaid
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  {!isAgent && !p.payment_method && (
                    <div className="mt-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium" style={{ background: "var(--k-FFF7ED)", color: "var(--kt-9A3412)" }}>
                      <Wallet className="h-3 w-3" /> No payment details — rent reminders are off
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate({ to: "/property-details/$propertyId", params: { propertyId: p.id } }); }}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Details
                    </button>
                    {!isAgent && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                    <span className="text-xs font-medium ml-auto" style={{ color: "var(--kt-166534)" }}>
                      View Dashboard →
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {!isAgent && (
            <button
              onClick={() => (isCompanyOfficer ? navigate({ to: "/register-property" }) : setAdding(true))}
              className="card-surface flex flex-col items-center justify-center p-8 border-2 border-dashed hover:border-primary transition-colors min-h-[200px]"
              style={{ borderColor: "var(--k-D1D5DB)" }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl mb-3" style={{ background: "var(--k-F0F0EB)" }}>
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
      {editing && (
        <PropertyForm
          initial={editing}
          onSave={(p) => editProperty.mutate({ id: editing.id, ...p })}
          onClose={() => setEditing(null)}
          saving={editProperty.isPending}
        />
      )}
      </div>
  );
}

/** Dropdown value for "not set yet" — mapped to null on save. */
const NO_PAYMENT_METHOD = "";

function PropertyForm({
  initial, onSave, onClose, saving,
}: {
  initial?: Property;
  onSave: (p: PropertyFormValues) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [totalUnits, setTotalUnits] = useState(initial?.total_units ?? 0);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | typeof NO_PAYMENT_METHOD>(
    initial?.payment_method ?? NO_PAYMENT_METHOD,
  );
  const [paymentNumber, setPaymentNumber] = useState(initial?.payment_number ?? "");
  const [paymentAccount, setPaymentAccount] = useState(initial?.payment_account ?? "");
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial?.photo_url ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image is too large — max 10MB");
      return;
    }
    setCropSrc(URL.createObjectURL(file));
  };

  const closeCropper = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const uploadCropped = async (blob: Blob) => {
    closeCropper();
    setUploading(true);
    try {
      const path = `${initial?.id ?? crypto.randomUUID()}/${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("property-photos")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      setPhotoUrl(supabase.storage.from("property-photos").getPublicUrl(path).data.publicUrl);
      toast.success("Photo ready — press Save to apply");
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't upload photo");
    } finally {
      setUploading(false);
    }
  };

  const numberLabel: Record<PaymentMethod, string> = {
    mpesa_paybill: "Paybill number",
    mpesa_till: "Till number",
    mpesa_phone: "M-Pesa phone number",
    bank: "Bank account number",
    cash: "",
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (paymentMethod && paymentMethod !== "cash" && !paymentNumber.trim()) {
      toast.error(`Enter a ${numberLabel[paymentMethod].toLowerCase()} before saving`);
      return;
    }

    onSave({
      name,
      location,
      description,
      total_units: totalUnits,
      payment_method: paymentMethod || null,
      payment_number: paymentMethod && paymentMethod !== "cash" ? paymentNumber.trim() : null,
      payment_account:
        paymentMethod === "mpesa_paybill" && paymentAccount.trim() ? paymentAccount.trim() : null,
      photo_url: photoUrl,
    });
  };

  // Render via a portal directly onto document.body so this modal isn't
  // affected by the page's animated <main> wrapper (a transformed ancestor
  // breaks `position: fixed`, making the modal open offset by the page's
  // scroll position instead of pinned to the true top of the screen).
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? "Edit Property" : "Add Property"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Property photo</label>
            <div
              className="relative h-36 w-full overflow-hidden rounded-xl grid place-items-center"
              style={{ background: "linear-gradient(135deg, var(--k-166534) 0%, var(--k-15803D) 100%)" }}
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Property" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <Building2 className="h-12 w-12 opacity-20 text-white" />
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {uploading ? "Uploading…" : photoUrl ? "Change photo" : "Add photo"}
              </button>
              {photoUrl && !uploading && (
                <button type="button" onClick={() => setPhotoUrl(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
                  Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          </div>
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

          {/* Payment details — only the landlord who owns this property can
              reach this form (agents never see the Edit button, and the
              properties query is scoped to the signed-in user's own rows).
              The database trigger enforces this same rule server-side, so
              this section is a convenience, not the actual security boundary. */}
          <div className="rounded-xl border border-border p-4" style={{ background: "var(--k-F9FAFB)" }}>
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4" style={{ color: "var(--kt-166534)" }} />
              <span className="text-sm font-semibold text-foreground">Payment details</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Used to fill in rent reminders sent to tenants at this property. Only you can change this.
            </p>

            <label className="mb-1.5 block text-xs font-medium text-foreground">How tenants pay</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | typeof NO_PAYMENT_METHOD)}
              className="form-input mb-3"
            >
              <option value={NO_PAYMENT_METHOD}>Not set yet</option>
              <option value="mpesa_paybill">M-Pesa Paybill</option>
              <option value="mpesa_till">M-Pesa Till (Buy Goods)</option>
              <option value="mpesa_phone">M-Pesa (Send Money to a phone number)</option>
              <option value="bank">Bank transfer</option>
              <option value="cash">Cash</option>
            </select>

            {paymentMethod && paymentMethod !== "cash" && (
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {numberLabel[paymentMethod]}
                </label>
                <input
                  value={paymentNumber}
                  onChange={(e) => setPaymentNumber(e.target.value)}
                  placeholder={
                    paymentMethod === "mpesa_phone" ? "e.g. 0712345678" : "e.g. 522522"
                  }
                  className="form-input"
                />
              </div>
            )}

            {paymentMethod === "mpesa_paybill" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Account number (optional)
                </label>
                <input
                  value={paymentAccount}
                  onChange={(e) => setPaymentAccount(e.target.value)}
                  placeholder="Leave blank to use each tenant's unit number"
                  className="form-input"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving || uploading} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-all glow-primary" style={{ background: "var(--k-166534)" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        {cropSrc && <PhotoCropper src={cropSrc} onCancel={closeCropper} onApply={uploadCropped} />}
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid var(--k-E5E7EB);background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}.form-input:focus{border-color:var(--kt-166534);box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>,
    document.body
  );
}