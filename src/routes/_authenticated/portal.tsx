import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatKES, formatDate } from "@/lib/format";
import { Download, Home, Wallet, Calendar, Eye, Building2, Phone, Mail } from "lucide-react";
import { downloadReceipt, getReceiptDataUrl, type ReceiptData } from "@/lib/receipt";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/portal")({
  component: TenantPortal,
});

function TenantPortal() {
  const { user } = useAuth();
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptData | null>(null);

  const { data: tenant } = useQuery({
    queryKey: ["my-tenant", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("*, properties(name, location)")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

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

  if (!tenant) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
          <Home className="h-10 w-10" style={{ color: "#166534" }} />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">Welcome!</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
          Your tenant record hasn't been linked yet. Ask your landlord or agent to share your invite code.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Your email: <span className="font-medium text-foreground">{user?.email}</span>
        </p>
      </div>
    );
  }

  const isOverdue = tenant.next_due_date && new Date(tenant.next_due_date) < new Date() && Number(tenant.balance) > 0;
  const firstName = tenant.full_name?.split(" ")[0];
  const initials = tenant.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="card-surface overflow-hidden">
        <div className="p-5 flex items-center gap-4" style={{ background: "linear-gradient(135deg, #166534 0%, #15803d 100%)" }}>
          <div
            className="grid h-14 w-14 place-items-center rounded-full text-xl font-bold text-white flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.2)" }}
          >
            {initials}
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-white">Hello, {firstName}!</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>Unit {tenant.unit}</p>
          </div>
        </div>

        {/* Property info */}
        {tenant.properties && (
          <div className="px-5 py-3 border-b border-border flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>{tenant.properties.name}</span>
            {tenant.properties.location && <span>· {tenant.properties.location}</span>}
          </div>
        )}

        {/* Tenant details */}
        <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-border">
          {tenant.email && (
            <div className="p-4 flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm font-medium truncate">{tenant.email}</div>
              </div>
            </div>
          )}
          {tenant.phone && (
            <div className="p-4 flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Phone</div>
                <div className="text-sm font-medium">{tenant.phone}</div>
              </div>
            </div>
          )}
          {tenant.move_in_date && (
            <div className="p-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Move-in Date</div>
                <div className="text-sm font-medium">{tenant.move_in_date}</div>
              </div>
            </div>
          )}
          <div className="p-4 flex items-center gap-2">
            <Home className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">Monthly Rent</div>
              <div className="text-sm font-medium">{formatKES(tenant.rent_amount)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Balance + next due */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card-surface p-5">
          <div className="text-xs text-muted-foreground mb-1">Current Balance</div>
          <div
            className="font-display text-2xl font-bold"
            style={{ color: Number(tenant.balance) === 0 ? "#16A34A" : "#DC2626" }}
          >
            {Number(tenant.balance) === 0 ? "Cleared ✓" : formatKES(tenant.balance)}
          </div>
          {Number(tenant.balance) > 0 && (
            <div className="text-xs mt-1" style={{ color: "#DC2626" }}>Outstanding</div>
          )}
        </div>
        <div className="card-surface p-5">
          <div className="text-xs text-muted-foreground mb-1">Next Due Date</div>
          <div
            className="font-display text-lg font-bold"
            style={{ color: isOverdue ? "#DC2626" : "#166534" }}
          >
            {tenant.next_due_date ?? "—"}
          </div>
          {isOverdue && (
            <div className="text-xs mt-1" style={{ color: "#DC2626" }}>⚠️ Overdue</div>
          )}
        </div>
      </div>

      {/* Deposit info */}
      {tenant.deposit != null && Number(tenant.deposit) > 0 && (
        <div className="card-surface p-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Deposit Held</div>
          <div className="text-sm font-semibold text-foreground">{formatKES(tenant.deposit)}</div>
        </div>
      )}

      {/* Payment history */}
      <div className="card-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-semibold">Payment History</h2>
        </div>

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