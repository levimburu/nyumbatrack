import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate } from "@/lib/format";
import { useProperty } from "@/context/PropertyContext";
import { Wallet, CheckCircle2, Clock, X, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/deposits" as any)({
  component: DepositsPage,
});

interface Deposit {
  id: string;
  tenant_id: string;
  property_id: string;
  amount: number;
  status: string;
  refunded_on: string | null;
  notes: string | null;
  created_at: string;
  tenant?: { full_name: string; unit: string };
}

function DepositsPage() {
  const qc = useQueryClient();
  const { selectedProperty } = useProperty();
  const [editing, setEditing] = useState<Partial<Deposit> | null>(null);
  const [refundTarget, setRefundTarget] = useState<Deposit | null>(null);

  const { data: deposits, isLoading } = useQuery({
    queryKey: ["deposits", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("deposits")
        .select("*, tenant:tenants(full_name, unit)")
        .eq("property_id", selectedProperty!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Deposit[];
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants", selectedProperty?.id],
    enabled: !!selectedProperty,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, full_name, unit, deposit")
        .eq("property_id", selectedProperty!.id)
        .order("unit");
      if (error) throw error;
      return data as { id: string; full_name: string; unit: string; deposit: number | null }[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (d: Partial<Deposit>) => {
      if (d.id) {
        const { error } = await (supabase as any)
          .from("deposits")
          .update({
            amount: d.amount,
            status: d.status,
            refunded_on: d.refunded_on ?? null,
            notes: d.notes ?? null,
          })
          .eq("id", d.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("deposits")
          .insert({
            tenant_id: d.tenant_id,
            property_id: selectedProperty!.id,
            amount: d.amount ?? 0,
            status: d.status ?? "held",
            refunded_on: d.refunded_on ?? null,
            notes: d.notes ?? null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deposits", selectedProperty?.id] });
      setEditing(null);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Mark a held deposit as refunded (today's date)
  const refund = useMutation({
    mutationFn: async (deposit: Deposit) => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await (supabase as any)
        .from("deposits")
        .update({ status: "refunded", refunded_on: today })
        .eq("id", deposit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deposits", selectedProperty?.id] });
      setRefundTarget(null);
      toast.success("Deposit refunded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalHeld = deposits
    ?.filter((d) => d.status === "held")
    .reduce((s, d) => s + Number(d.amount), 0) ?? 0;

  const totalRefunded = deposits
    ?.filter((d) => d.status === "refunded")
    .reduce((s, d) => s + Number(d.amount), 0) ?? 0;

  const heldCount = deposits?.filter((d) => d.status === "held").length ?? 0;
  const refundedCount = deposits?.filter((d) => d.status === "refunded").length ?? 0;

  // Tenants who don't yet have a deposit record — only these are offered
  // in the "Add Deposit" form, so you can't add a duplicate deposit.
  const tenantIdsWithDeposit = new Set((deposits ?? []).map((d) => d.tenant_id));
  const tenantsWithoutDeposit = (tenants ?? []).filter((t) => !tenantIdsWithDeposit.has(t.id));

  if (!selectedProperty) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Deposits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedProperty.name} · {deposits?.length ?? 0} records
          </p>
        </div>
        <button
          onClick={() => {
            if (tenantsWithoutDeposit.length === 0) {
              toast.error("All tenants already have a deposit recorded.");
              return;
            }
            setEditing({});
          }}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white glow-primary"
          style={{ background: "#166534" }}
        >
          + Add Deposit
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Held</div>
          <div className="font-display text-xl font-bold" style={{ color: "#166534" }}>{formatKES(totalHeld)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{heldCount} tenants</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Refunded</div>
          <div className="font-display text-xl font-bold text-muted-foreground">{formatKES(totalRefunded)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{refundedCount} refunded</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Deposits Held</div>
          <div className="font-display text-xl font-bold text-foreground">{heldCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">active</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Refunded</div>
          <div className="font-display text-xl font-bold text-foreground">{refundedCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">returned</div>
        </div>
      </div>

      {/* Table — desktop */}
      <div className="card-surface overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Tenant</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Unit</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Amount</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Refunded On</th>
              <th className="py-3 text-left text-xs font-medium text-muted-foreground">Notes</th>
              <th className="py-3 pr-5 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">Loading...</td></tr>
            )}
            {!isLoading && !deposits?.length && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">No deposits recorded yet.</td></tr>
            )}
            {deposits?.map((d) => (
              <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="px-5 py-3 font-medium">{d.tenant?.full_name ?? "—"}</td>
                <td className="py-3 text-muted-foreground">{d.tenant?.unit ?? "—"}</td>
                <td className="py-3 font-semibold">{formatKES(d.amount)}</td>
                <td className="py-3">
                  <StatusBadge status={d.status} />
                </td>
                <td className="py-3 text-muted-foreground text-xs">
                  {d.refunded_on ? formatDate(d.refunded_on) : "—"}
                </td>
                <td className="py-3 text-muted-foreground text-xs max-w-[180px] truncate">
                  {d.notes ?? "—"}
                </td>
                <td className="py-3 pr-5 text-right">
                  <div className="inline-flex items-center gap-1">
                    {d.status === "held" && (
                      <button
                        onClick={() => setRefundTarget(d)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors"
                        style={{ borderColor: "#166534", color: "#166534", background: "#F0FDF4" }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Refund
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(d)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {isLoading && <div className="text-sm text-muted-foreground text-center py-10">Loading...</div>}
        {!isLoading && !deposits?.length && (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground">No deposits recorded yet.</div>
        )}
        {deposits?.map((d) => (
          <div key={d.id} className="card-surface p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-foreground">{d.tenant?.full_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Unit {d.tenant?.unit ?? "—"}</div>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <div>
                <div className="text-xs text-muted-foreground">Amount</div>
                <div className="font-semibold">{formatKES(d.amount)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Refunded On</div>
                <div className="font-medium">{d.refunded_on ? formatDate(d.refunded_on) : "—"}</div>
              </div>
            </div>
            {d.notes && <div className="text-xs text-muted-foreground mb-3">{d.notes}</div>}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              {d.status === "held" && (
                <button
                  onClick={() => setRefundTarget(d)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors"
                  style={{ borderColor: "#166534", color: "#166534", background: "#F0FDF4" }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Refund
                </button>
              )}
              <button
                onClick={() => setEditing(d)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <DepositForm
          initial={editing}
          tenants={editing.id ? (tenants ?? []) : tenantsWithoutDeposit}
          onSave={(d) => upsert.mutate(d)}
          onClose={() => setEditing(null)}
          saving={upsert.isPending}
        />
      )}

      {refundTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card-surface w-full max-w-sm p-6 animate-slide-up text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
              <CheckCircle2 className="h-7 w-7" style={{ color: "#166534" }} />
            </div>
            <h2 className="font-display text-xl font-semibold mb-1">Refund Deposit</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Mark <span className="font-semibold text-foreground">{formatKES(refundTarget.amount)}</span> deposit for{" "}
              <span className="font-semibold text-foreground">{refundTarget.tenant?.full_name}</span> as refunded? Today's date will be recorded.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRefundTarget(null)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => refund.mutate(refundTarget)}
                disabled={refund.isPending}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "#166534" }}
              >
                {refund.isPending ? "Refunding…" : "Confirm Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "refunded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "#F0F0EB", color: "#6B7280" }}>
        <CheckCircle2 className="h-3 w-3" /> Refunded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "#DCFCE7", color: "#166534" }}>
      <Clock className="h-3 w-3" /> Held
    </span>
  );
}

function DepositForm({ initial, tenants, onSave, onClose, saving }: {
  initial: Partial<Deposit>;
  tenants: { id: string; full_name: string; unit: string; deposit: number | null }[];
  onSave: (d: Partial<Deposit>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<Deposit>>({
    ...initial,
    status: initial.status ?? "held",
    amount: initial.amount ?? 0,
  });

  const set = <K extends keyof Deposit>(k: K, v: any) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-md p-6 animate-slide-up">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">
            {initial.id ? "Edit Deposit" : "Add Deposit"}
          </h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <div className="space-y-4">
          {!initial.id && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Tenant *</label>
              <select
                required
                value={form.tenant_id ?? ""}
                onChange={(e) => set("tenant_id", e.target.value)}
                className="form-input"
              >
                <option value="">Select tenant...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} — Unit {t.unit}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Amount (KES) *</label>
            <input
              type="number" min={0}
              value={form.amount ?? 0}
              onChange={(e) => set("amount", Number(e.target.value))}
              className="form-input"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Status</label>
            <select
              value={form.status ?? "held"}
              onChange={(e) => set("status", e.target.value)}
              className="form-input"
            >
              <option value="held">Held</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          {form.status === "refunded" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Refunded On</label>
              <input
                type="date"
                value={form.refunded_on ?? ""}
                onChange={(e) => set("refunded_on", e.target.value)}
                className="form-input"
              />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Notes (optional)</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="form-input resize-none"
              placeholder="Any notes about this deposit..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button
              onClick={() => onSave(form)}
              disabled={saving || !form.tenant_id && !initial.id}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 glow-primary"
              style={{ background: "#166534" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>
  );
}