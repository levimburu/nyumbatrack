import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { CheckCircle2, Wrench, Building2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface TicketRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  property_id: string;
}

type ActivityIcon = "payment" | "ticket" | "done";
interface ActivityItem {
  key: string;
  icon: ActivityIcon;
  title: string;
  detail: string;
  when: string;
  sortTime: number;
  propertyName: string;
}

function formatShortDate(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ActivityPage() {
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
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

  // Same "properties I can see" logic used everywhere else.
  const { data: properties } = useQuery({
    queryKey: ["activity-properties", profileLoaded, isAgent],
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
          .select("id, name, location, user_id")
          .in("user_id", landlordIds);
        if (error) throw error;
        return data as Property[];
      } else {
        const { data, error } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id")
          .eq("user_id", user.id);
        if (error) throw error;
        return data as Property[];
      }
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);
  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? "Unknown property";

  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["activity-payments", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("id, amount, paid_on, tenants(full_name, unit, property_id)")
        .order("paid_on", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as any[]).filter((p) => propertyIds.includes(p.tenants?.property_id));
    },
  });

  const { data: tickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ["activity-tickets", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_tickets")
        .select("id, title, status, created_at, property_id")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as TicketRow[];
    },
  });

  const activityFeed: ActivityItem[] = [
    ...(payments ?? []).map((p: any) => ({
      key: `pay-${p.id}`,
      icon: "payment" as ActivityIcon,
      title: `Rent received from ${p.tenants?.full_name ?? "a tenant"}`,
      detail: `${formatKES(p.amount)} · Unit ${p.tenants?.unit ?? "—"}`,
      when: formatShortDate(p.paid_on),
      sortTime: new Date(p.paid_on).getTime(),
      propertyName: propertyName(p.tenants?.property_id),
    })),
    ...(tickets ?? []).map((t) => ({
      key: `ticket-${t.id}`,
      icon: (t.status === "done" ? "done" : "ticket") as ActivityIcon,
      title: t.status === "done" ? "Maintenance ticket completed" : "Maintenance ticket logged",
      detail: t.title,
      when: timeAgo(t.created_at),
      sortTime: new Date(t.created_at).getTime(),
      propertyName: propertyName(t.property_id),
    })),
  ].sort((a, b) => b.sortTime - a.sortTime);

  if (!profileLoaded || paymentsLoading || ticketsLoading) {
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
          <CheckCircle2 className="h-10 w-10" style={{ color: "#166534" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs">
          Add a property first to see activity here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Activity</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every payment and maintenance ticket across {properties.length} {properties.length === 1 ? "property" : "properties"}, newest first.
        </p>
      </div>

      <div className="card-surface p-5">
        {activityFeed.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nothing logged yet.</p>
        ) : (
          <div className="space-y-3">
            {activityFeed.map((a) => (
              <div key={a.key} className="flex items-start gap-3 pb-3 last:pb-0 border-b last:border-b-0" style={{ borderColor: "#F0F0EB" }}>
                <div
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full"
                  style={{ background: a.icon === "ticket" ? "#FEF3C7" : "#DCFCE7" }}
                >
                  {a.icon === "payment" && <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />}
                  {a.icon === "ticket" && <Wrench className="h-4 w-4" style={{ color: "#D97706" }} />}
                  {a.icon === "done" && <CheckCircle2 className="h-4 w-4" style={{ color: "#16A34A" }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{a.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Building2 className="h-3 w-3 flex-shrink-0" /> {a.propertyName} · {a.detail}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex-shrink-0">{a.when}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}