import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { outstandingForDueMonth } from "@/lib/reminders";
import { downloadStatement } from "@/lib/statement";
import { FileText, Download, Building2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/statements")({
  component: StatementsPage,
});

interface Landlord {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface TenantMin {
  id: string;
  rent_amount: number;
  next_due_date: string | null;
  property_id: string;
}

interface PaymentMin {
  id: string;
  tenant_id: string;
  amount: number;
  paid_on: string;
  payment_month: string | null;
}

interface TicketCostRow {
  id: string;
  property_id: string;
  cost: number | null;
  created_at: string;
}

interface PropertyStatement {
  propertyId: string;
  propertyName: string;
  collected: number;
  maintenanceCost: number;
  net: number;
  outstanding: number;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

function StatementsPage() {
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedLandlordId, setSelectedLandlordId] = useState<string>("");
  const [startDate, setStartDate] = useState(firstOfMonthISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [statement, setStatement] = useState<PropertyStatement[] | null>(null);
  const [landlordLabel, setLandlordLabel] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAgent(data?.role === "agent");
      setProfileLoaded(true);
    });
  }, []);

  // Only an agent/PM needs to pick which landlord's statement this is —
  // a landlord logging in directly is only ever generating their own.
  const { data: landlords } = useQuery({
    queryKey: ["statement-landlords", profileLoaded, isAgent],
    enabled: profileLoaded && isAgent === true,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: links } = await (supabase as any)
        .from("agent_landlord")
        .select("landlord_id")
        .eq("agent_id", user.id);
      const landlordIds = (links ?? []).map((l: any) => l.landlord_id);
      if (!landlordIds.length) return [] as Landlord[];
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .in("id", landlordIds);
      if (error) throw error;
      return data as Landlord[];
    },
  });

  useEffect(() => {
    if (isAgent === false && userId) {
      setSelectedLandlordId(userId);
    } else if (isAgent === true && landlords?.length && !selectedLandlordId) {
      setSelectedLandlordId(landlords[0].id);
    }
  }, [isAgent, userId, landlords]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (!selectedLandlordId) {
      toast.error("Select a landlord first");
      return;
    }
    setGenerating(true);
    try {
      const { data: properties, error: propErr } = await (supabase as any)
        .from("properties")
        .select("id, name, location, user_id")
        .eq("user_id", selectedLandlordId)
        .order("name", { ascending: true });
      if (propErr) throw propErr;

      if (!properties?.length) {
        toast.error("This landlord has no properties yet");
        setStatement(null);
        setGenerating(false);
        return;
      }

      const propertyIds: string[] = properties.map((p: Property) => p.id);

      const { data: tenants, error: tenErr } = await (supabase as any)
        .from("tenants")
        .select("id, rent_amount, next_due_date, property_id")
        .in("property_id", propertyIds);
      if (tenErr) throw tenErr;

      const tenantIds: string[] = (tenants ?? []).map((t: TenantMin) => t.id);
      const safeTenantIds = tenantIds.length ? tenantIds : [PLACEHOLDER_ID];

      // Payments within the statement period — drives "Collected".
      const { data: periodPayments, error: payErr } = await (supabase as any)
        .from("payments")
        .select("id, tenant_id, amount, paid_on, payment_month")
        .in("tenant_id", safeTenantIds)
        .gte("paid_on", startDate)
        .lte("paid_on", endDate);
      if (payErr) throw payErr;

      // ALL payments per tenant (not just this period) — needed to compute
      // each tenant's current outstanding via the same
      // outstandingForDueMonth logic used everywhere else in the app.
      const { data: allPayments, error: allPayErr } = await (supabase as any)
        .from("payments")
        .select("id, tenant_id, amount, paid_on, payment_month")
        .in("tenant_id", safeTenantIds);
      if (allPayErr) throw allPayErr;

      // Maintenance costs logged within the statement period.
      const { data: tickets, error: tickErr } = await (supabase as any)
        .from("maintenance_tickets")
        .select("id, property_id, cost, created_at")
        .in("property_id", propertyIds)
        .gte("created_at", startDate)
        .lte("created_at", endDate + "T23:59:59");
      if (tickErr) throw tickErr;

      const tenantToProperty: Record<string, string> = {};
      (tenants ?? []).forEach((t: TenantMin) => { tenantToProperty[t.id] = t.property_id; });

      const collectedByProperty: Record<string, number> = {};
      (periodPayments ?? []).forEach((p: PaymentMin) => {
        const pid = tenantToProperty[p.tenant_id];
        if (!pid) return;
        collectedByProperty[pid] = (collectedByProperty[pid] ?? 0) + Number(p.amount);
      });

      const costByProperty: Record<string, number> = {};
      (tickets ?? []).forEach((t: TicketCostRow) => {
        costByProperty[t.property_id] = (costByProperty[t.property_id] ?? 0) + Number(t.cost ?? 0);
      });

      const allPaymentsByTenant: Record<string, PaymentMin[]> = {};
      (allPayments ?? []).forEach((p: PaymentMin) => {
        (allPaymentsByTenant[p.tenant_id] ??= []).push(p);
      });

      const outstandingByProperty: Record<string, number> = {};
      (tenants ?? []).forEach((t: TenantMin) => {
        const { due } = outstandingForDueMonth(t.rent_amount, t.next_due_date, allPaymentsByTenant[t.id] ?? []);
        outstandingByProperty[t.property_id] = (outstandingByProperty[t.property_id] ?? 0) + due;
      });

      const rows: PropertyStatement[] = properties.map((p: Property) => {
        const collected = collectedByProperty[p.id] ?? 0;
        const maintenanceCost = costByProperty[p.id] ?? 0;
        return {
          propertyId: p.id,
          propertyName: p.name,
          collected,
          maintenanceCost,
          net: collected - maintenanceCost,
          outstanding: outstandingByProperty[p.id] ?? 0,
        };
      });

      setStatement(rows);
      const landlord = landlords?.find((l) => l.id === selectedLandlordId);
      setLandlordLabel(isAgent === false ? "Your Properties" : (landlord?.full_name || landlord?.email || "Landlord"));
      toast.success("Statement ready");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate statement");
    } finally {
      setGenerating(false);
    }
  };

  const totals = statement?.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      maintenanceCost: acc.maintenanceCost + r.maintenanceCost,
      net: acc.net + r.net,
      outstanding: acc.outstanding + r.outstanding,
    }),
    { collected: 0, maintenanceCost: 0, net: 0, outstanding: 0 },
  );

  const handleDownload = () => {
    if (!statement || !totals) return;
    downloadStatement({
      landlordName: landlordLabel || "Owner",
      periodLabel: `${startDate} to ${endDate}`,
      generatedOn: todayISO(),
      rows: statement.map((r) => ({
        propertyName: r.propertyName,
        collected: r.collected,
        maintenanceCost: r.maintenanceCost,
        net: r.net,
        outstanding: r.outstanding,
      })),
      totals,
    });
  };

  if (!profileLoaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Owner Statements</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generate a combined PDF statement — rent collected, maintenance costs, and outstanding — across all of a landlord's properties.
        </p>
      </div>

      <div className="card-surface p-5 space-y-4">
        {isAgent && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Landlord</label>
            <select
              value={selectedLandlordId}
              onChange={(e) => setSelectedLandlordId(e.target.value)}
              className="form-input"
            >
              {!landlords?.length && <option value="">No linked landlords found</option>}
              {landlords?.map((l) => (
                <option key={l.id} value={l.id}>{l.full_name || l.email || l.id}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" />
          </div>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary disabled:opacity-60"
          style={{ background: "#166534" }}
        >
          <FileText className="h-4 w-4" /> {generating ? "Generating…" : "Generate Statement"}
        </button>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>

      {statement && totals && (
        <div className="card-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-foreground">Preview</h2>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all glow-primary"
              style={{ background: "#166534" }}
            >
              <Download className="h-4 w-4" /> Download PDF
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Property</th>
                  <th className="py-2 pr-3">Collected</th>
                  <th className="py-2 pr-3">Maintenance</th>
                  <th className="py-2 pr-3">Net</th>
                  <th className="py-2">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {statement.map((r) => (
                  <tr key={r.propertyId} className="border-b border-border/50">
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {r.propertyName}
                      </span>
                    </td>
                    <td className="py-2 pr-3" style={{ color: "#16A34A" }}>{formatKES(r.collected)}</td>
                    <td className="py-2 pr-3" style={{ color: "#DC2626" }}>{formatKES(r.maintenanceCost)}</td>
                    <td className="py-2 pr-3 font-semibold">{formatKES(r.net)}</td>
                    <td className="py-2" style={{ color: r.outstanding > 0 ? "#DC2626" : "#16A34A" }}>{formatKES(r.outstanding)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3" style={{ color: "#16A34A" }}>{formatKES(totals.collected)}</td>
                  <td className="py-2 pr-3" style={{ color: "#DC2626" }}>{formatKES(totals.maintenanceCost)}</td>
                  <td className="py-2 pr-3">{formatKES(totals.net)}</td>
                  <td className="py-2" style={{ color: totals.outstanding > 0 ? "#DC2626" : "#16A34A" }}>{formatKES(totals.outstanding)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}