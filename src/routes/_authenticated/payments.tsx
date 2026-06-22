import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Plus, X, Download, Search, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { downloadReceipt, getReceiptDataUrl, type ReceiptData } from "@/lib/receipt";
import { useProperty } from "@/context/PropertyContext";

export const Route = createFileRoute("/_authenticated/payments")({
  component: PaymentsPage,
});

interface PaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  paid_on: string;
  method: string;
  reference: string | null;
  note: string | null;
  payment_month: string | null;
  created_at: string;
  tenants: { full_name: string; unit: string; property_id: string } | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = -2; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    options.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
  }
  return options;
}

function MethodBadge({ method }: { method: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    mpesa: { bg: "#DCFCE7", color: "#166534", label: "M-Pesa" },
    bank: { bg: "#EFF6FF", color: "#2563EB", label: "Bank Transfer" },
    cash: { bg: "#F5F5F0", color: "#6B7280", label: "Cash" },
  };
  const s = styles[method] ?? styles.cash;
  return (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36) + pin.length.toString();
}

function isWithin96Hours(createdAt: string): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  return diffHours <= 96;
}

type PaymentType = "full" | "partial" | "topup";

function PaymentsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { selectedProperty } = useProperty();
  const [adding, setAdding] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptData | null>(null);
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<PaymentRow | null>(null);

  useEffect(() => {
    if (!selectedProperty) navigate({ to: "/properties" });
  }, [selectedProperty, navigate]);

  const { data: payments } = useQuery({
    queryKey: ["payments", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("*, tenants(full_name, unit, property_id)")
        .order("paid_on", { ascending: false });
      if (error) throw error;
      const all = data as PaymentRow[];
      return all.filter((p) => p.tenants?.property_id === selectedProperty!.id);
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants-min", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, full_name, unit, rent_amount, due_day, next_due_date")
        .eq("property_id", selectedProperty!.id)
        .order("unit");
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = payments?.filter((p) =>
    (p.tenants?.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (p.reference ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (p.tenants?.unit ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalAmount = payments?.reduce((s, p) => s + Number(p.amount), 0) ?? 0;

  const add = useMutation({
    mutationFn: async (p: {
      tenant_id: string;
      amount: number;
      paid_on: string;
      method: string;
      reference: string;
      note: string;
      payment_month: string;
      payment_type: PaymentType;
    }) => {
      const tenant = tenants?.find((t) => t.id === p.tenant_id);
      const { payment_type, ...paymentData } = p;

      // Insert the payment row
      const { error } = await supabase.from("payments").insert({ ...paymentData } as any);
      if (error) throw error;

      if (!tenant) return;

      // Parse payment_month (e.g. "June 2026") to compute next due date
      // next_due_date = 1st day of the month AFTER the payment month + due_day offset
      const advanceNextDueDate = async () => {
        const parts = p.payment_month?.split(" ");
        if (!parts || parts.length < 2) return;
        const monthIndex = MONTHS.indexOf(parts[0]);
        const year = parseInt(parts[1]);
        if (monthIndex === -1 || isNaN(year)) return;
        const nextDue = new Date(year, monthIndex + 1, tenant.due_day ?? 1);
        await (supabase.from("tenants") as any)
          .update({ next_due_date: nextDue.toISOString().slice(0, 10) })
          .eq("id", p.tenant_id);
      };

      if (payment_type === "full") {
        await advanceNextDueDate();
      } else if (payment_type === "topup") {
        // Check if total paid this month now equals full rent
        const { data: monthPayments } = await (supabase as any)
          .from("payments")
          .select("amount")
          .eq("tenant_id", p.tenant_id)
          .eq("payment_month", p.payment_month);
        const totalPaid = (monthPayments ?? []).reduce((s: number, row: any) => s + Number(row.amount), 0);
        if (totalPaid >= Number(tenant.rent_amount)) {
          await advanceNextDueDate();
        }
      }
      // partial: do not advance next_due_date
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["tenants", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["tenants-min", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["payments-recent", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["payments-this-month", selectedProperty?.id] });
      setAdding(false);
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelPayment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["tenants", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["payments-recent", selectedProperty?.id] });
      setCancelTarget(null);
      toast.success("Payment cancelled successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Payments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedProperty.name} · {payments?.length ?? 0} records · Total {formatKES(totalAmount)}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white glow-primary"
          style={{ background: "#166634" }}
        >
          <Plus className="h-4 w-4" /> Record Payment
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by tenant or reference..."
          className="w-full rounded-xl border border-border bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Desktop table */}
      <div className="card-surface overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Date</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Tenant</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Unit</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Month Paid</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Method</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Reference</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Amount</th>
              <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered?.map((p) => {
              const receiptData: ReceiptData = {
                tenantName: p.tenants?.full_name ?? "—",
                unit: p.tenants?.unit ?? "—",
                amount: Number(p.amount),
                paidOn: p.paid_on,
                method: p.method,
                reference: p.reference,
                receiptNo: p.id.slice(0, 8).toUpperCase(),
                paymentMonth: p.payment_month,
              };
              const initials = (p.tenants?.full_name ?? "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              const canCancel = p.created_at && isWithin96Hours(p.created_at);
              return (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(p.paid_on)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0" style={{ background: "#166534" }}>
                        {initials}
                      </div>
                      <span className="font-medium">{p.tenants?.full_name ?? "—"}</span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{p.tenants?.unit}</td>
                  <td className="py-3">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "#F5F5F0", color: "#374151" }}>
                      {p.payment_month ?? "—"}
                    </span>
                  </td>
                  <td className="py-3"><MethodBadge method={p.method} /></td>
                  <td className="py-3 text-muted-foreground font-mono text-xs">{p.reference ?? "—"}</td>
                  <td className="py-3 font-display font-bold" style={{ color: "#16A34A" }}>{formatKES(p.amount)}</td>
                  <td className="py-3 pr-5 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => setPreviewReceipt(receiptData)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                      </button>
                      {canCancel && (
                        <button
                          onClick={() => setCancelTarget(p)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors"
                          style={{ borderColor: "#FCA5A5", color: "#DC2626", background: "#FEF2F2" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered?.length && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {search ? "No payments match your search." : `No payments recorded yet for ${selectedProperty.name}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {filtered?.map((p) => {
          const receiptData: ReceiptData = {
            tenantName: p.tenants?.full_name ?? "—",
            unit: p.tenants?.unit ?? "—",
            amount: Number(p.amount),
            paidOn: p.paid_on,
            method: p.method,
            reference: p.reference,
            receiptNo: p.id.slice(0, 8).toUpperCase(),
            paymentMonth: p.payment_month,
          };
          const initials = (p.tenants?.full_name ?? "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
          const canCancel = p.created_at && isWithin96Hours(p.created_at);
          return (
            <div key={p.id} className="card-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0" style={{ background: "#166534" }}>
                    {initials}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{p.tenants?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">Unit {p.tenants?.unit} · {formatDate(p.paid_on)} · {p.payment_month}</div>
                  </div>
                </div>
                <div className="font-display font-bold" style={{ color: "#16A34A" }}>{formatKES(p.amount)}</div>
              </div>
              <div className="flex items-center justify-between">
                <MethodBadge method={p.method} />
                <div className="flex gap-2">
                  <button
                    onClick={() => setPreviewReceipt(receiptData)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                  >
                    <Receipt className="h-3.5 w-3.5" /> Receipt
                  </button>
                  {canCancel && (
                    <button
                      onClick={() => setCancelTarget(p)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors"
                      style={{ borderColor: "#FCA5A5", color: "#DC2626", background: "#FEF2F2" }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!filtered?.length && (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground">
            {search ? "No payments match your search." : `No payments recorded yet for ${selectedProperty.name}.`}
          </div>
        )}
      </div>

      {adding && (
        <PaymentForm
          tenants={tenants ?? []}
          payments={payments ?? []}
          onSave={(p) => add.mutate(p)}
          onClose={() => setAdding(false)}
          saving={add.isPending}
          monthOptions={getMonthOptions()}
        />
      )}

      {previewReceipt && (
        <ReceiptPreview
          data={previewReceipt}
          onClose={() => setPreviewReceipt(null)}
        />
      )}

      {cancelTarget && (
        <CancelPaymentModal
          payment={cancelTarget}
          onConfirm={() => cancelPayment.mutate(cancelTarget.id)}
          onClose={() => setCancelTarget(null)}
          cancelling={cancelPayment.isPending}
        />
      )}
    </div>
  );
}

function CancelPaymentModal({ payment, onConfirm, onClose, cancelling }: {
  payment: PaymentRow;
  onConfirm: () => void;
  onClose: () => void;
  cancelling: boolean;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handlePinInput = async (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === 4) {
      setVerifying(true);
      setError("");
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        const enteredHash = hashPin(newPin);
        const localPin = localStorage.getItem(`nyumbatrack_pin_${user.id}`);
        if (localPin && localPin === enteredHash) { onConfirm(); return; }
        const { data: profile } = await (supabase as any)
          .from("profiles").select("pin_hash").eq("id", user.id).maybeSingle();
        if (profile?.pin_hash === enteredHash) {
          onConfirm();
        } else {
          setError("Incorrect PIN. Please try again.");
          setPin("");
        }
      } catch {
        setError("Verification failed. Please try again.");
        setPin("");
      } finally {
        setVerifying(false);
      }
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-6 animate-slide-up text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "#FEE2E2" }}>
          <Trash2 className="h-7 w-7" style={{ color: "#DC2626" }} />
        </div>
        <h2 className="font-display text-xl font-semibold mb-1">Cancel Payment</h2>
        <p className="text-sm text-muted-foreground mb-2">
          Cancelling <span className="font-bold text-foreground">{formatKES(payment.amount)}</span> for <span className="font-bold text-foreground">{payment.tenants?.full_name}</span>.
        </p>
        <p className="text-xs text-muted-foreground mb-6">Enter your PIN to confirm.</p>
        <div className="flex justify-center gap-4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 w-4 rounded-full border-2 transition-all duration-200"
              style={{ background: i < pin.length ? "#DC2626" : "transparent", borderColor: i < pin.length ? "#DC2626" : "#D1D5DB" }} />
          ))}
        </div>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        {verifying && <p className="text-muted-foreground text-sm mb-3">Verifying...</p>}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {keys.map((k, i) => (
            k === "" ? <div key={i} /> :
            k === "⌫" ? (
              <button key={i} onClick={() => setPin((p) => p.slice(0, -1))}
                className="h-12 rounded-xl border border-border text-foreground text-lg font-bold flex items-center justify-center hover:bg-muted transition-colors">⌫</button>
            ) : (
              <button key={i} onClick={() => handlePinInput(k)} disabled={verifying || cancelling}
                className="h-12 rounded-xl border border-border text-foreground text-lg font-bold flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-50">{k}</button>
            )
          ))}
        </div>
        <button onClick={onClose} className="w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">Go back</button>
      </div>
    </div>
  );
}

function ReceiptPreview({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  const dataUrl = getReceiptDataUrl(data);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-lg flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-white">Receipt Preview</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadReceipt(data)}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
              style={{ background: "#166534" }}>
              <Download className="h-4 w-4" /> Download PDF
            </button>
            <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 rounded-xl overflow-hidden bg-white shadow-2xl">
          <iframe src={dataUrl} className="w-full h-full" title="Receipt Preview" style={{ minHeight: "500px" }} />
        </div>
      </div>
    </div>
  );
}

function PaymentForm({
  tenants, payments, onSave, onClose, saving, monthOptions,
}: {
  tenants: { id: string; full_name: string; unit: string; rent_amount: number; due_day: number; next_due_date: string | null }[];
  payments: PaymentRow[];
  onSave: (p: { tenant_id: string; amount: number; paid_on: string; method: string; reference: string; note: string; payment_month: string; payment_type: PaymentType }) => void;
  onClose: () => void;
  saving: boolean;
  monthOptions: string[];
}) {
  const currentMonth = monthOptions[2] ?? "";
  const [paymentType, setPaymentType] = useState<PaymentType>("full");
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [amount, setAmount] = useState<number>(tenants[0]?.rent_amount ?? 0);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("mpesa");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [paymentMonth, setPaymentMonth] = useState(currentMonth);

  const partialTenants = tenants.filter((t) => {
    const paid = payments
      .filter((p) => p.tenant_id === t.id && p.payment_month === paymentMonth)
      .reduce((s, p) => s + Number(p.amount), 0);
    return paid > 0 && paid < Number(t.rent_amount);
  }).map((t) => {
    const paid = payments
      .filter((p) => p.tenant_id === t.id && p.payment_month === paymentMonth)
      .reduce((s, p) => s + Number(p.amount), 0);
    return { ...t, alreadyPaid: paid, remaining: Number(t.rent_amount) - paid };
  });

  const handleTypeChange = (type: PaymentType) => {
    setPaymentType(type);
    if (type === "topup") {
      if (partialTenants.length > 0) {
        setTenantId(partialTenants[0].id);
        setAmount(partialTenants[0].remaining);
      }
    } else {
      setTenantId(tenants[0]?.id ?? "");
      setAmount(tenants[0]?.rent_amount ?? 0);
    }
  };

  const handleTenantChange = (id: string) => {
    setTenantId(id);
    if (paymentType === "topup") {
      const pt = partialTenants.find((t) => t.id === id);
      if (pt) setAmount(pt.remaining);
    } else {
      const t = tenants.find((x) => x.id === id);
      if (t) setAmount(Number(t.rent_amount));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentType === "topup" && partialTenants.length === 0) {
      toast.error("No tenants with partial payments for this month.");
      return;
    }
    onSave({ tenant_id: tenantId, amount: Number(amount), paid_on: paidOn, method, reference, note, payment_month: paymentMonth, payment_type: paymentType });
  };

  const tabStyle = (active: boolean) => ({
    flex: 1,
    padding: "8px 0",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    background: active ? "#166534" : "transparent",
    color: active ? "#fff" : "#6B7280",
    transition: "all 0.15s",
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Record Payment</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>

        <div className="flex gap-1 rounded-xl p-1 mb-5" style={{ background: "#F5F5F0" }}>
          <button type="button" style={tabStyle(paymentType === "full")} onClick={() => handleTypeChange("full")}>Full Payment</button>
          <button type="button" style={tabStyle(paymentType === "partial")} onClick={() => handleTypeChange("partial")}>Partial</button>
          <button type="button" style={tabStyle(paymentType === "topup")} onClick={() => handleTypeChange("topup")}>Top-up</button>
        </div>

        {paymentType === "full" && (
          <p className="text-xs text-muted-foreground mb-4 -mt-2">Tenant has paid rent in full. Their status will update to Paid.</p>
        )}
        {paymentType === "partial" && (
          <p className="text-xs text-muted-foreground mb-4 -mt-2">Tenant is paying part of their rent. They will remain marked as Partial until fully paid.</p>
        )}
        {paymentType === "topup" && (
          <p className="text-xs text-muted-foreground mb-4 -mt-2">Adding to a previous partial payment. If the total reaches full rent, tenant is marked as Paid.</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Month</label>
            <select required value={paymentMonth} onChange={(e) => { setPaymentMonth(e.target.value); }} className="form-input">
              {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {paymentType === "topup" ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Tenant with partial payment</label>
              {partialTenants.length === 0 ? (
                <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground text-center">
                  No tenants with partial payments for {paymentMonth}.
                </div>
              ) : (
                <div className="space-y-2">
                  {partialTenants.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleTenantChange(t.id)}
                      className="w-full rounded-xl border-2 p-3 text-left transition-all"
                      style={{
                        borderColor: tenantId === t.id ? "#166534" : "#E5E7EB",
                        background: tenantId === t.id ? "#F0FDF4" : "#fff",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-sm text-foreground">{t.full_name}</div>
                          <div className="text-xs text-muted-foreground">Unit {t.unit}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Paid: <span className="font-semibold text-foreground">{formatKES(t.alreadyPaid)}</span></div>
                          <div className="text-xs" style={{ color: "#DC2626" }}>Remaining: <span className="font-semibold">{formatKES(t.remaining)}</span></div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Tenant</label>
              <select required value={tenantId} onChange={(e) => handleTenantChange(e.target.value)} className="form-input">
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name} – Unit {t.unit}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              Amount (KSh)
              {paymentType === "topup" && tenantId && (() => {
                const pt = partialTenants.find((t) => t.id === tenantId);
                return pt ? <span className="ml-1 text-muted-foreground font-normal">(Remaining: {formatKES(pt.remaining)})</span> : null;
              })()}
            </label>
            <input required type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="form-input" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="form-input">
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Reference / Transaction Code</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="form-input" placeholder="e.g. QCA5H3K8JL" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Date Paid</label>
            <input required type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="form-input" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button
              type="submit"
              disabled={saving || (paymentType === "topup" && partialTenants.length === 0)}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 glow-primary"
              style={{ background: "#166534" }}
            >
              {saving ? "Saving…" : "Record Payment"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>
  );
}