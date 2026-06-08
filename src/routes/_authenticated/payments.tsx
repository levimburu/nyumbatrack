import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Plus, X, Download } from "lucide-react";
import { toast } from "sonner";
import { downloadReceipt } from "@/lib/receipt";

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
  tenants: { full_name: string; unit: string } | null;
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

function PaymentsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data: payments } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, tenants(full_name, unit)")
        .order("paid_on", { ascending: false });
      if (error) throw error;
      return data as PaymentRow[];
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, full_name, unit, rent_amount, due_day").order("unit");
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async (p: { tenant_id: string; amount: number; paid_on: string; method: string; reference: string; note: string; payment_month: string }) => {
      // Calculate next due date
      const tenant = tenants?.find(t => t.id === p.tenant_id);
      const paidDate = new Date(p.paid_on);
      const nextDue = new Date(paidDate.getFullYear(), paidDate.getMonth() + 1, tenant?.due_day ?? 1);
      const nextDueStr = nextDue.toISOString().slice(0, 10);

      const { error } = await supabase.from("payments").insert({
        ...p,
        payment_month: p.payment_month,
      });
      if (error) throw error;

      // Update tenant's next due date
      if (tenant) {
        await supabase.from("tenants").update({ next_due_date: nextDueStr }).eq("id", p.tenant_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["payments-recent"] });
      setAdding(false);
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Ledger</div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Payments</h1>
        </div>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-glow">
          <Plus className="h-4 w-4" /> Record payment
        </button>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Date</th>
              <th>Tenant</th>
              <th>Unit</th>
              <th>Month Paid</th>
              <th>Method</th>
              <th>Reference</th>
              <th>Amount</th>
              <th className="pr-5 text-right">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {payments?.map((p) => (
              <tr key={p.id} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
                <td className="px-5 py-3 text-muted-foreground">{formatDate(p.paid_on)}</td>
                <td className="font-medium">{p.tenants?.full_name ?? "—"}</td>
                <td>{p.tenants?.unit}</td>
                <td>
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {p.payment_month ?? "—"}
                  </span>
                </td>
                <td><span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium uppercase">{p.method}</span></td>
                <td className="text-muted-foreground">{p.reference ?? "—"}</td>
                <td className="font-display font-semibold text-success">+{formatKES(p.amount)}</td>
                <td className="pr-5 text-right">
                  <button onClick={() => downloadReceipt({
                    tenantName: p.tenants?.full_name ?? "—",
                    unit: p.tenants?.unit ?? "—",
                    amount: Number(p.amount), paidOn: p.paid_on, method: p.method,
                    reference: p.reference, receiptNo: p.id.slice(0, 8).toUpperCase(),
                  })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Download className="h-3.5 w-3.5" /> PDF
                  </button>
                </td>
              </tr>
            ))}
            {!payments?.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && <PaymentForm tenants={tenants ?? []} onSave={(p) => add.mutate(p)} onClose={() => setAdding(false)} saving={add.isPending} monthOptions={getMonthOptions()} />}
    </div>
  );
}

function PaymentForm({ tenants, onSave, onClose, saving, monthOptions }: {
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Record payment</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ tenant_id: tenantId, amount: Number(amount), paid_on: paidOn, method, reference, note, payment_month: paymentMonth }); }} className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium">Tenant</span>
            <select required value={tenantId} onChange={(e) => {
              const id = e.target.value; setTenantId(id);
              const t = tenants.find((x) => x.id === id); if (t) setAmount(Number(t.rent_amount));
            }} className="form-input">
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name} · Unit {t.unit}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium">Month being paid for</span>
            <select required value={paymentMonth} onChange={(e) => setPaymentMonth(e.target.value)} className="form-input">
              {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Amount (KES)</span>
            <input required type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="form-input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Date paid</span>
            <input required type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="form-input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="form-input">
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="form-input" placeholder="MPESA-XYZ123" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium">Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="form-input" />
          </label>
          <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="glow-primary rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-glow disabled:opacity-60">
              {saving ? "Saving…" : "Save payment"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.5rem;border:1px solid var(--color-border);background:var(--color-card);padding:.5rem .75rem;font-size:.875rem;outline:none}.form-input:focus{border-color:var(--color-ring);box-shadow:0 0 0 3px rgba(37,99,235,0.12)}`}</style>
      </div>
    </div>
  );
}