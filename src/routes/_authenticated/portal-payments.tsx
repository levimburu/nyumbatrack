import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { Download, Eye } from "lucide-react";
import { downloadReceipt, getReceiptDataUrl, type ReceiptData } from "@/lib/receipt";
import { useState } from "react";
import { useMyTenant } from "@/hooks/use-my-tenant";

export const Route = createFileRoute("/_authenticated/portal-payments")({
  component: TenantPayments,
});

function TenantPayments() {
  const { data: tenant } = useMyTenant();
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptData | null>(null);

  const { data: payments } = useQuery({
    queryKey: ["my-payments", tenant?.id],
    enabled: !!tenant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("paid_on", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // TenantShell already gates on "no linked tenant" before rendering any
  // page, so by the time we're here tenant is guaranteed to exist.
  if (!tenant) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your full rent payment history and receipts.</p>
      </div>

      <div className="card-surface">
        {/* Mobile cards */}
        <div className="divide-y divide-border md:hidden">
          {payments?.map((p) => {
            const receiptData: ReceiptData = {
              tenantName: tenant.full_name,
              unit: tenant.unit,
              amount: Number(p.amount),
              paidOn: p.paid_on,
              method: p.method,
              reference: p.reference,
              receiptNo: p.id.slice(0, 8).toUpperCase(),
              paymentMonth: p.payment_month,
            };
            return (
              <div key={p.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold">
                      {p.payment_month ?? formatDate(p.paid_on)}
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDate(p.paid_on)}</div>
                  </div>
                  <div className="font-display font-bold" style={{ color: "#16A34A" }}>
                    +{formatKES(p.amount)}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={p.method === "mpesa"
                      ? { background: "#DCFCE7", color: "#166534" }
                      : p.method === "bank"
                      ? { background: "#EFF6FF", color: "#2563EB" }
                      : { background: "#F5F5F0", color: "#6B7280" }
                    }
                  >
                    {p.method === "mpesa" ? "M-Pesa" : p.method === "bank" ? "Bank Transfer" : "Cash"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPreviewReceipt(receiptData)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" /> View
                    </button>
                    <button
                      onClick={() => downloadReceipt(receiptData)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!payments?.length && (
            <div className="p-10 text-center text-sm text-muted-foreground">No payments yet.</div>
          )}
        </div>

        {/* Desktop table */}
        <table className="w-full text-sm hidden md:table">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Date</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Month</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Method</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Reference</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Amount</th>
              <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {payments?.map((p) => {
              const receiptData: ReceiptData = {
                tenantName: tenant.full_name,
                unit: tenant.unit,
                amount: Number(p.amount),
                paidOn: p.paid_on,
                method: p.method,
                reference: p.reference,
                receiptNo: p.id.slice(0, 8).toUpperCase(),
                paymentMonth: p.payment_month,
              };
              return (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(p.paid_on)}</td>
                  <td className="py-3">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{ background: "#DCFCE7", color: "#166534" }}
                    >
                      {p.payment_month ?? "—"}
                    </span>
                  </td>
                  <td className="py-3">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={p.method === "mpesa"
                        ? { background: "#DCFCE7", color: "#166534" }
                        : p.method === "bank"
                        ? { background: "#EFF6FF", color: "#2563EB" }
                        : { background: "#F5F5F0", color: "#6B7280" }
                      }
                    >
                      {p.method === "mpesa" ? "M-Pesa" : p.method === "bank" ? "Bank Transfer" : "Cash"}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground font-mono text-xs">{p.reference ?? "—"}</td>
                  <td className="py-3 font-display font-bold" style={{ color: "#16A34A" }}>
                    +{formatKES(p.amount)}
                  </td>
                  <td className="py-3 pr-5 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => setPreviewReceipt(receiptData)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      <button
                        onClick={() => downloadReceipt(receiptData)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!payments?.length && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No payments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Receipt preview modal */}
      {previewReceipt && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-lg flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg font-semibold text-white">Receipt</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadReceipt(previewReceipt)}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: "#166534" }}
                >
                  <Download className="h-4 w-4" /> Download
                </button>
                <button
                  onClick={() => setPreviewReceipt(null)}
                  className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 rounded-xl overflow-hidden bg-white shadow-2xl">
              <iframe
                src={getReceiptDataUrl(previewReceipt)}
                className="w-full h-full"
                title="Receipt"
                style={{ minHeight: "500px" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
