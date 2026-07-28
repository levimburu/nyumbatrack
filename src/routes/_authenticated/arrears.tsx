import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { outstandingForDueMonth } from "@/lib/reminders";
import { ReminderButton, type PropertyPaymentDetails } from "@/components/ReminderButton";
import { useProperty } from "@/context/PropertyContext";
import { AlertCircle, Building2, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/arrears")({
  component: ArrearsPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
  payment_method: string | null;
  payment_number: string | null;
  payment_account: string | null;
}

interface TenantRow {
  id: string;
  full_name: string;
  phone: string | null;
  unit: string;
  rent_amount: number;
  next_due_date: string | null;
  property_id: string;
}

interface PaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  paid_on: string;
  payment_month: string | null;
  method: string;
}

function ArrearsPage() {
  const navigate = useNavigate();
  const { setSelectedProperty } = useProperty();
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

  // Same "properties I can see" logic used everywhere else, plus the
  // payment-detail columns ReminderButton needs per property.
  const { data: properties } = useQuery({
    queryKey: ["arrears-properties", profileLoaded, isAgent],
    enabled: profileLoaded && isAgent !== null,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (isAgent) {
        const { data: links } = await (supabase as any)
          .from("agent_landlord")
          .select("landlord_id")
          .eq("agent_id", user.id);
        const landlordIds = (links ?? []).map((l: any) => l.landlord_id);
        if (!landlordIds.length) return [] as Property[];
        const { data, error } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id, payment_method, payment_number, payment_account")
          .in("user_id", landlordIds)
          .order("name", { ascending: true });
        if (error) throw error;
        return data as Property[];
      } else {
        const { data, error } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id, payment_method, payment_number, payment_account")
          .eq("user_id", user.id)
          .order("name", { ascending: true });
        if (error) throw error;
        return data as Property[];
      }
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);
  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? "Unknown property";
  const propertyPaymentDetails = (id: string): PropertyPaymentDetails | null => {
    const p = properties?.find((x) => x.id === id);
    if (!p) return null;
    return { payment_method: p.payment_method as any, payment_number: p.payment_number, payment_account: p.payment_account };
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  // Every tenant, across every accessible property, whose next due date has
  // already passed — the same "past due date" definition Portfolio's own
  // arrears count already uses, so the two never disagree.
  const { data: arrearsTenants, isLoading } = useQuery({
    queryKey: ["arrears-tenants", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, full_name, phone, unit, rent_amount, next_due_date, property_id")
        .in("property_id", propertyIds)
        .lte("next_due_date", todayStr)
        .not("next_due_date", "is", null)
        .order("next_due_date", { ascending: true });
      if (error) throw error;
      return data as TenantRow[];
    },
  });

  const tenantIds = (arrearsTenants ?? []).map((t) => t.id);

  const { data: allPayments } = useQuery({
    queryKey: ["arrears-payments", tenantIds.join(",")],
    enabled: tenantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("id, tenant_id, amount, paid_on, payment_month, method")
        .in("tenant_id", tenantIds);
      if (error) throw error;
      return data as PaymentRow[];
    },
  });

  const paymentsByTenant: Record<string, PaymentRow[]> = {};
  (allPayments ?? []).forEach((p) => {
    (paymentsByTenant[p.tenant_id] ??= []).push(p);
  });

  // Same due-amount logic used on the tenant profile and Portfolio — a
  // tenant whose next_due_date passed but who's since caught up (a payment
  // arrived) drops off this list, since they're no longer actually owing.
  const rows = (arrearsTenants ?? [])
    .map((t) => {
      const { due } = outstandingForDueMonth(t.rent_amount, t.next_due_date, paymentsByTenant[t.id] ?? []);
      const daysOverdue = t.next_due_date
        ? Math.floor((Date.now() - new Date(t.next_due_date).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return { ...t, due, daysOverdue };
    })
    .filter((r) => r.due > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const totalOwed = rows.reduce((s, r) => s + r.due, 0);

  const goToTenant = (propertyId: string) => {
    const prop = properties?.find((p) => p.id === propertyId);
    if (prop) setSelectedProperty({ id: prop.id, name: prop.name, location: prop.location });
    navigate({ to: "/tenants" });
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
        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#FEE2E2" }}>
          <AlertCircle className="h-10 w-10" style={{ color: "#DC2626" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Add a property first to track tenants in arrears.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Tenants in Arrears</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {rows.length} {rows.length === 1 ? "tenant" : "tenants"} behind on rent across {properties.length} {properties.length === 1 ? "property" : "properties"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card-surface p-4 flex items-center gap-3">
          <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#FEE2E2" }}>
            <AlertCircle className="h-5 w-5" style={{ color: "#DC2626" }} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Tenants Behind</div>
            <div className="font-display text-lg font-bold" style={{ color: "#DC2626" }}>{rows.length}</div>
          </div>
        </div>
        <div className="card-surface p-4 flex items-center gap-3">
          <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#FEE2E2" }}>
            <AlertCircle className="h-5 w-5" style={{ color: "#DC2626" }} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Total Owed</div>
            <div className="font-display text-lg font-bold" style={{ color: "#DC2626" }}>{formatKES(totalOwed)}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {rows.length === 0 && (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            No one's behind on rent right now.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="card-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-foreground truncate">{r.full_name}</h3>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Building2 className="h-3 w-3 flex-shrink-0" /> {propertyName(r.property_id)} · Unit {r.unit}
                </div>
                {r.phone && (
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Phone className="h-3 w-3 flex-shrink-0" /> {r.phone}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-display text-lg font-bold" style={{ color: "#DC2626" }}>{formatKES(r.due)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.daysOverdue} {r.daysOverdue === 1 ? "day" : "days"} overdue</div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid #F0F0EB" }}>
              <button
                onClick={() => goToTenant(r.property_id)}
                className="text-xs font-semibold"
                style={{ color: "#166534" }}
              >
                View tenant →
              </button>
              <ReminderButton
                tenant={r}
                payments={paymentsByTenant[r.id] ?? []}
                property={propertyPaymentDetails(r.property_id)}
                landlordName={fullName}
                variant="icon"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}