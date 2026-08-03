import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { Plus, X, Landmark, Building2, TrendingUp, TrendingDown, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/financials")({
  component: FinancialsPage,
});

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface PaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  paid_on: string;
}

interface TenantMin {
  id: string;
  property_id: string;
}

interface TicketCostRow {
  id: string;
  property_id: string;
  cost: number | null;
  created_at: string;
}

export interface Expense {
  id: string;
  property_id: string;
  category: string;
  amount: number;
  expense_date: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

const EXPENSE_CATEGORIES = [
  "Maintenance & Repairs",
  "Utilities",
  "Staff & Security",
  "Insurance",
  "Land Rates & Taxes",
  "Cleaning",
  "Other",
];

const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function FinancialsPage() {
  const qc = useQueryClient();
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [startDate, setStartDate] = useState(firstOfMonthISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [addingExpense, setAddingExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAgent(data?.role === "agent");
    });
  }, []);

  // Same "properties I can manage" pattern as Maintenance/Arrears — an agent
  // sees every property across their linked landlords, a landlord sees only
  // their own. RLS on every child table enforces the same scope server-side.
  const { data: properties } = useQuery({
    queryKey: ["financials-properties", isAgent],
    enabled: isAgent !== null,
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
          .in("user_id", landlordIds)
          .order("name", { ascending: true });
        if (error) throw error;
        return data as Property[];
      }
      const { data, error } = await (supabase as any)
        .from("properties")
        .select("id, name, location, user_id")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Property[];
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);
  const safePropertyIds = propertyIds.length ? propertyIds : [PLACEHOLDER_ID];

  const { data: tenants } = useQuery({
    queryKey: ["financials-tenants", propertyIds.join(",")],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("id, property_id")
        .in("property_id", safePropertyIds);
      if (error) throw error;
      return data as TenantMin[];
    },
  });

  const tenantIds = (tenants ?? []).map((t) => t.id);
  const safeTenantIds = tenantIds.length ? tenantIds : [PLACEHOLDER_ID];

  // Revenue — rent actually collected in the selected window.
  const { data: periodPayments } = useQuery({
    queryKey: ["financials-payments", tenantIds.join(","), startDate, endDate],
    enabled: tenantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("id, tenant_id, amount, paid_on")
        .in("tenant_id", safeTenantIds)
        .gte("paid_on", startDate)
        .lte("paid_on", endDate);
      if (error) throw error;
      return data as PaymentRow[];
    },
  });

  // Expenses, side 1 — maintenance ticket costs already tracked elsewhere in
  // the app. Pulled in automatically as "Maintenance & Repairs" so nothing
  // has to be logged twice.
  const { data: tickets } = useQuery({
    queryKey: ["financials-tickets", propertyIds.join(","), startDate, endDate],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_tickets")
        .select("id, property_id, cost, created_at")
        .in("property_id", safePropertyIds)
        .gte("created_at", startDate)
        .lte("created_at", endDate + "T23:59:59");
      if (error) throw error;
      return data as TicketCostRow[];
    },
  });

  // Expenses, side 2 — everything else (utilities, staff, insurance, etc.),
  // logged directly here since nothing else in the app captures them.
  const { data: expenses } = useQuery({
    queryKey: ["financials-expenses", propertyIds.join(","), startDate, endDate],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("property_expenses")
        .select("*")
        .in("property_id", safePropertyIds)
        .gte("expense_date", startDate)
        .lte("expense_date", endDate)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
  });

  const createExpense = useMutation({
    mutationFn: async (e: { property_id: string; category: string; amount: number; expense_date: string; description: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await (supabase as any).from("property_expenses").insert({
        property_id: e.property_id,
        category: e.category,
        amount: e.amount,
        expense_date: e.expense_date,
        description: e.description || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financials-expenses"] });
      setAddingExpense(false);
      toast.success("Expense recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateExpense = useMutation({
    mutationFn: async (e: { id: string; property_id: string; category: string; amount: number; expense_date: string; description: string }) => {
      const { error } = await (supabase as any)
        .from("property_expenses")
        .update({
          property_id: e.property_id,
          category: e.category,
          amount: e.amount,
          expense_date: e.expense_date,
          description: e.description || null,
        })
        .eq("id", e.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financials-expenses"] });
      setEditingExpense(null);
      toast.success("Expense updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("property_expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financials-expenses"] });
      toast.success("Expense removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tenantToProperty: Record<string, string> = {};
  (tenants ?? []).forEach((t) => { tenantToProperty[t.id] = t.property_id; });

  const collectedByProperty: Record<string, number> = {};
  (periodPayments ?? []).forEach((p) => {
    const pid = tenantToProperty[p.tenant_id];
    if (!pid) return;
    collectedByProperty[pid] = (collectedByProperty[pid] ?? 0) + Number(p.amount);
  });

  const maintenanceByProperty: Record<string, number> = {};
  (tickets ?? []).forEach((t) => {
    maintenanceByProperty[t.property_id] = (maintenanceByProperty[t.property_id] ?? 0) + Number(t.cost ?? 0);
  });

  const manualExpenseByProperty: Record<string, number> = {};
  (expenses ?? []).forEach((e) => {
    manualExpenseByProperty[e.property_id] = (manualExpenseByProperty[e.property_id] ?? 0) + Number(e.amount);
  });

  const categoryTotals: Record<string, number> = {};
  (tickets ?? []).forEach((t) => {
    if (!t.cost) return;
    categoryTotals["Maintenance & Repairs"] = (categoryTotals["Maintenance & Repairs"] ?? 0) + Number(t.cost);
  });
  (expenses ?? []).forEach((e) => {
    categoryTotals[e.category] = (categoryTotals[e.category] ?? 0) + Number(e.amount);
  });

  const rows = (properties ?? []).map((p) => {
    const collected = collectedByProperty[p.id] ?? 0;
    const expensesTotal = (maintenanceByProperty[p.id] ?? 0) + (manualExpenseByProperty[p.id] ?? 0);
    return { property: p, collected, expenses: expensesTotal, net: collected - expensesTotal };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      expenses: acc.expenses + r.expenses,
      net: acc.net + r.net,
    }),
    { collected: 0, expenses: 0, net: 0 },
  );

  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? "Unknown property";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Financials</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Rent collected and money spent, per property.
          </p>
        </div>
        <button
          onClick={() => setAddingExpense(true)}
          disabled={!properties?.length}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all glow-primary disabled:opacity-60"
          style={{ background: "#166534" }}
        >
          <Plus className="h-4 w-4" /> Add Expense
        </button>
      </div>

      <div className="card-surface p-5">
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" />
          </div>
        </div>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card-surface p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" style={{ color: "#16A34A" }} /> Collected
          </div>
          <div className="font-display text-lg font-bold leading-tight break-words" style={{ color: "#16A34A" }}>{formatKES(totals.collected)}</div>
        </div>
        <div className="card-surface p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <TrendingDown className="h-3.5 w-3.5" style={{ color: "#DC2626" }} /> Expenses
          </div>
          <div className="font-display text-lg font-bold leading-tight break-words" style={{ color: "#DC2626" }}>{formatKES(totals.expenses)}</div>
        </div>
        <div className="card-surface p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Landmark className="h-3.5 w-3.5" style={{ color: "#166534" }} /> Net
          </div>
          <div className="font-display text-lg font-bold leading-tight break-words" style={{ color: totals.net >= 0 ? "#166534" : "#DC2626" }}>{formatKES(totals.net)}</div>
        </div>
      </div>

      {Object.keys(categoryTotals).length > 0 && (
        <div className="card-surface p-5">
          <h2 className="font-display font-bold text-foreground mb-3">Expenses by Category</h2>
          <div className="space-y-2">
            {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <div key={cat} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{cat}</span>
                <span className="font-semibold">{formatKES(amt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-surface p-5 overflow-x-auto">
        <h2 className="font-display font-bold text-foreground mb-3">By Property</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3">Property</th>
              <th className="py-2 pr-3">Collected</th>
              <th className="py-2 pr-3">Expenses</th>
              <th className="py-2">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.property.id} className="border-b border-border/50">
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {r.property.name}
                  </span>
                </td>
                <td className="py-2 pr-3" style={{ color: "#16A34A" }}>{formatKES(r.collected)}</td>
                <td className="py-2 pr-3" style={{ color: "#DC2626" }}>{formatKES(r.expenses)}</td>
                <td className="py-2 font-semibold" style={{ color: r.net >= 0 ? "#166534" : "#DC2626" }}>{formatKES(r.net)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No properties yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card-surface p-5">
        <h2 className="font-display font-bold text-foreground mb-3">Recorded Expenses</h2>
        {!expenses?.length ? (
          <p className="text-sm text-muted-foreground">No expenses recorded for this period yet.</p>
        ) : (
          <div className="space-y-2">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{propertyName(e.property_id)} · {e.category}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {e.expense_date}{e.description ? ` — ${e.description}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="font-semibold" style={{ color: "#DC2626" }}>{formatKES(e.amount)}</span>
                  <button onClick={() => setEditingExpense(e)} className="text-muted-foreground hover:text-foreground" aria-label="Edit expense">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => deleteExpense.mutate(e.id)} className="text-muted-foreground hover:text-red-600" aria-label="Delete expense">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(addingExpense || editingExpense) && (
        <ExpenseForm
          properties={properties ?? []}
          initial={editingExpense}
          onSave={(e) =>
            editingExpense
              ? updateExpense.mutate({ id: editingExpense.id, ...e })
              : createExpense.mutate(e)
          }
          onClose={() => { setAddingExpense(false); setEditingExpense(null); }}
          saving={createExpense.isPending || updateExpense.isPending}
        />
      )}
    </div>
  );
}

function ExpenseForm({
  properties, initial, onSave, onClose, saving,
}: {
  properties: Property[];
  initial?: Expense | null;
  onSave: (e: { property_id: string; category: string; amount: number; expense_date: string; description: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [propertyId, setPropertyId] = useState(initial?.property_id ?? properties[0]?.id ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [expenseDate, setExpenseDate] = useState(initial?.expense_date ?? todayISO());
  const [description, setDescription] = useState(initial?.description ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) { toast.error("Select a property"); return; }
    if (!category.trim()) { toast.error("Enter a category"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    onSave({ property_id: propertyId, category: category.trim(), amount: amt, expense_date: expenseDate, description: description.trim() });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? "Edit Expense" : "Add Expense"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Property *</label>
            <select required value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="form-input">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Category *</label>
            <input required list="expense-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Utilities" className="form-input" />
            <datalist id="expense-categories">
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Amount (Ksh) *</label>
            <input required type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Date *</label>
            <input required type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any extra detail..." rows={3} className="form-input resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-all glow-primary" style={{ background: "#166534" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.625rem;border:1px solid #E5E7EB;background:#fff;padding:.625rem .875rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}.form-input:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,0.1)}`}</style>
      </div>
    </div>,
    document.body
  );
}
