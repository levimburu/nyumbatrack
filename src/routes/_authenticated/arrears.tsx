import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { outstandingForDueMonth } from "@/lib/reminders";
import { ReminderButton, type PropertyPaymentDetails } from "@/components/ReminderButton";
import { useProperty } from "@/context/PropertyContext";
import { AlertCircle, Building2, Phone, Wallet, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
  due_day: number | null;
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

interface ArrearsRow extends TenantRow {
  due: number;
  dueLabel: string;
  dueStatus: string;
  daysOverdue: number;
}

function ArrearsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [payingRow, setPayingRow] = useState<ArrearsRow | null>(null);
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
        .select("id, full_name, phone, unit, rent_amount, next_due_date, due_day, property_id")
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
      const { due, label, status } = outstandingForDueMonth(t.rent_amount, t.next_due_date, paymentsByTenant[t.id] ?? []);
      const daysOverdue = t.next_due_date
        ? Math.floor((Date.now() - new Date(t.next_due_date).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return { ...t, due, dueLabel: label, dueStatus: status, daysOverdue };
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
            <div className="flex items-center justify-between mt-3 pt-3 gap-2" style={{ borderTop: "1px solid #F0F0EB" }}>
              <button
                onClick={() => goToTenant(r.property_id)}
                className="text-xs font-semibold flex-shrink-0"
                style={{ color: "#166534" }}
              >
                View tenant →
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setPayingRow(r)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "#166534" }}
                >
                  <Wallet className="h-3.5 w-3.5" /> Record Payment
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
          </div>
        ))}
      </div>

      {payingRow && (
        <RecordPaymentModal
          row={payingRow}
          existingPayments={paymentsByTenant[payingRow.id] ?? []}
          onClose={() => setPayingRow(null)}
          onSaved={() => {
            setPayingRow(null);
            qc.invalidateQueries({ queryKey: ["arrears-tenants"] });
            qc.invalidateQueries({ queryKey: ["arrears-payments"] });
          }}
        />
      )}
    </div>
  );
}

function RecordPaymentModal({
  row, existingPayments, onClose, onSaved,
}: {
  row: ArrearsRow;
  existingPayments: PaymentRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  type PaymentType = "full" | "partial" | "topup";
  const alreadyPaidForMonth = existingPayments
    .filter((p) => p.payment_month === row.dueLabel)
    .reduce((s, p) => s + Number(p.amount), 0);
  const isPartialMonth = row.dueStatus === "partial";

  const [paymentType, setPaymentType] = useState<PaymentType>(isPartialMonth ? "topup" : "full");
  const [amount, setAmount] = useState<number>(row.due);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("mpesa");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleTypeChange = (type: PaymentType) => {
    setPaymentType(type);
    if (type === "full" || type === "topup") setAmount(row.due);
  };

  const advanceNextDueDate = async () => {
    const parts = row.dueLabel.split(" ");
    if (parts.length < 2) return;
    const monthIndex = MONTHS.indexOf(parts[0]);
    const year = parseInt(parts[1]);
    if (monthIndex === -1 || isNaN(year)) return;
    const nextDue = new Date(year, monthIndex + 1, row.due_day ?? 1);
    await (supabase.from("tenants") as any)
      .update({ next_due_date: nextDue.toISOString().slice(0, 10) })
      .eq("id", row.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("payments").insert({
        tenant_id: row.id,
        amount,
        paid_on: paidOn,
        method,
        reference,
        note,
        payment_month: row.dueLabel,
      } as any);
      if (error) throw error;

      if (paymentType === "full") {
        await advanceNextDueDate();
      } else if (paymentType === "topup") {
        const totalPaid = alreadyPaidForMonth + amount;
        if (totalPaid >= Number(row.rent_amount)) await advanceNextDueDate();
      }
      // "partial" never advances the due date — there's still a remainder owing.

      toast.success("Payment recorded");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-white">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Record Payment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{row.full_name} · Unit {row.unit} · {row.dueLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Payment Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(isPartialMonth ? (["topup", "partial"] as PaymentType[]) : (["full", "partial"] as PaymentType[])).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className="rounded-lg border py-2 text-xs font-semibold capitalize"
                  style={paymentType === t
                    ? { borderColor: "#166534", background: "#F0FDF4", color: "#166534" }
                    : { borderColor: "#E5E7EB", color: "#6B7280" }}
                >
                  {t === "topup" ? "Top Up (rest owed)" : t === "full" ? "Full Amount" : "Partial"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Amount (KES)</label>
            <input
              type="number" min="1" step="1" value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={paymentType !== "partial"}
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none disabled:opacity-60"
              style={{ borderColor: "#E5E7EB" }}
            />
            {paymentType !== "partial" && (
              <p className="text-xs text-muted-foreground mt-1">Full amount owed for {row.dueLabel}.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date Paid</label>
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={{ borderColor: "#E5E7EB" }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none" style={{ borderColor: "#E5E7EB" }}>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank Transfer</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Reference (optional)</label>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="M-Pesa code, etc." className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: "#E5E7EB" }} />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: "#E5E7EB" }} />
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2" style={{ background: "#166534" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Payment
          </button>
        </div>
      </form>
    </div>
  );
}