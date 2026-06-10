import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Plus, X, Download, Eye, Search, Receipt } from "lucide-react";
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

function PaymentsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { selectedProperty } = useProperty();
  const [adding, setAdding] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptData | null>(null);
  const [search, setSearch] = useState("");

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
        .select("id, full_name, unit, rent_amount, due_day")
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
    }) => {
      const tenant = tenants?.find((t) => t.id === p.tenant_id);
      const paidDate = new Date(p.paid_on);
      const nextDue = new Date(
        paidDate.getFullYear(),
        paidDate.getMonth() + 1,
        tenant?.due_day ?? 1
      );
      const nextDueStr = nextDue.toISOString().slice(0, 10);
      const { error } = await supabase.from("payments").insert({ ...p } as any);
      if (error) throw error;
      if (tenant) {
        await (supabase.from("tenants") as any).update({ next_due_date: nextDueStr }).eq("id", p.tenant_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["tenants", selectedProperty?.id] });
      qc.invalidateQueries({ queryKey: ["payments-recent", selectedProperty?.id] });
      setAdding(false);
      toast.success("Payment recorded");
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
          style={{ background: "#166534" }}
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
              <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Receipt</th>
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
              return (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(p.paid_on)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0"
                        style={{ background: "#166534" }}
                      >
                        {initials}
                      </div>
                      <span className="font-medium">{p.tenants?.full_name ?? "—"}</span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{p.tenants?.unit}</td>
                  <td className="py-3">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{ background: "#F5F5F0", color: "#374151" }}
                    >
                      {p.payment_month ?? "—"}
                    </span>
                  </td>
                  <td className="py-3"><MethodBadge method={p.method} /></td>
                  <td className="py-3 text-muted-foreground font-mono text-xs">{p.reference ?? "—"}</td>
                  <td className="py-3 font-display font-bold" style={{ color: "#16A34A" }}>
                    {formatKES(p.amount)}
                  </td>
                  <td className="py-3 pr-5 text-right">
                    <button
                      onClick={() => setPreviewReceipt(receiptData)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                    >
                      <Receipt className="h-3.5 w-3.5" />
                    </button>
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
          return (
            <div key={p.id} className="card-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white flex-shrink-0"
                    style={{ background: "#166534" }}
                  >
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
                <button
                  onClick={() => setPreviewReceipt(receiptData)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                >
                  <Receipt className="h-3.5 w-3.5" /> View Receipt
                </button>
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
            <button
              onClick={() => downloadReceipt(data)}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
              style={{ background: "#166534" }}
            >
              <Download className="h-4 w-4" /> Download PDF
            </button>
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
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
  tenants, onSave, onClose, saving, monthOptions,
}: {
  tenants: { id: string; full_name: string; unit: string; rent_amount: number; due_day: number }[];
  onSave: (p: { tenant_id: string; amount: number; paid_on: string; method: string; reference: string; note: string; payment_month: string }) => void;
  onClose: () => void;
  saving: boolean;
  monthOptions: string[];
}) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [amount, setAmount] = useState<number>(tenants[0]?.rent_amount ?? 0);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("mpesa");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [paymentMonth, setPaymentMonth] = useState(monthOptions[2] ?? "");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Record Payment</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSave({ tenant_id: tenantId, amount: Number(amount), paid_on: paidOn, method, reference, note, payment_month: paymentMonth }); }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Tenant</label>
            <select
              required value={tenantId}
              onChange={(e) => { const id = e.target.value; setTenantId(id); const t = tenants.find((x) => x.id === id); if (t) setAmount(Number(t.rent_amount)); }}
              className="form-input"
            >
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name} – Unit {t.unit}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Amount (KSh)</label>
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
            <label className="mb-1.5 block text-xs font-medium text-foreground">Month Paid</label>
            <select required value={paymentMonth} onChange={(e) => setPaymentMonth(e.target.value)} className="form-input">
              {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Date Paid</label>
            <input required type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="form-input" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button
              type="submit" disabled={saving}
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