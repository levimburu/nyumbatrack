import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "./dashboard";

export const Route = createFileRoute("/_authenticated/tenants")({
  component: TenantsPage,
});

interface Tenant {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  unit: string;
  rent_amount: number;
  deposit: number;
  due_day: number;
  balance: number;
  status: string;
}

function TenantsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Tenant> | null>(null);

  const { data } = useQuery({
    queryKey: ["tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("*").order("unit");
      if (error) throw error;
      return data as Tenant[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (t: Partial<Tenant>) => {
      if (t.id) {
        const { error } = await supabase.from("tenants").update({
          full_name: t.full_name, email: t.email, phone: t.phone,
          unit: t.unit, rent_amount: t.rent_amount, deposit: t.deposit, due_day: t.due_day,
        }).eq("id", t.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tenants").insert({
          full_name: t.full_name!, email: t.email, phone: t.phone,
          unit: t.unit!, rent_amount: t.rent_amount ?? 0,
          deposit: t.deposit ?? 0, due_day: t.due_day ?? 1,
          balance: t.rent_amount ?? 0,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tenants"] }); setEditing(null); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tenants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tenants"] }); toast.success("Tenant removed"); },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Manage</div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Tenants</h1>
        </div>
        <button onClick={() => setEditing({})} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-glow">
          <Plus className="h-4 w-4" /> Add tenant
        </button>
      </div>

      <div className="card-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Name</th><th>Unit</th><th>Phone</th><th>Rent</th><th>Balance</th><th>Status</th><th className="text-right pr-5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((t) => {
              const status = Number(t.balance) === 0 ? "paid" : Number(t.balance) < Number(t.rent_amount) ? "partial" : "unpaid";
              return (
                <tr key={t.id} className="border-t border-border/60">
                  <td className="px-5 py-3">
                    <div className="font-medium">{t.full_name}</div>
                    <div className="text-xs text-muted-foreground">{t.email}</div>
                  </td>
                  <td>{t.unit}</td>
                  <td className="text-muted-foreground">{t.phone}</td>
                  <td>{formatKES(t.rent_amount)}</td>
                  <td className="font-medium">{formatKES(t.balance)}</td>
                  <td><StatusPill status={status as "paid" | "partial" | "unpaid"} /></td>
                  <td className="pr-5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setEditing(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => { if (confirm(`Remove ${t.full_name}?`)) del.mutate(t.id); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!data?.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">No tenants yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <TenantForm initial={editing} onSave={(t) => upsert.mutate(t)} onClose={() => setEditing(null)} saving={upsert.isPending} />}
    </div>
  );
}

function TenantForm({ initial, onSave, onClose, saving }: { initial: Partial<Tenant>; onSave: (t: Partial<Tenant>) => void; onClose: () => void; saving: boolean }) {
  const [form, setForm] = useState<Partial<Tenant>>(initial);
  const set = <K extends keyof Tenant>(k: K, v: Tenant[K]) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4">
      <div className="card-surface w-full max-w-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial.id ? "Edit tenant" : "Add tenant"}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Full name" className="sm:col-span-2"><input required value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} className="form-input" /></FormField>
          <FormField label="Email"><input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} className="form-input" /></FormField>
          <FormField label="Phone"><input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="form-input" placeholder="+254…" /></FormField>
          <FormField label="Unit"><input required value={form.unit ?? ""} onChange={(e) => set("unit", e.target.value)} className="form-input" /></FormField>
          <FormField label="Due day (1-28)"><input type="number" min={1} max={28} value={form.due_day ?? 1} onChange={(e) => set("due_day", Number(e.target.value))} className="form-input" /></FormField>
          <FormField label="Monthly rent (KES)"><input type="number" min={0} value={form.rent_amount ?? 0} onChange={(e) => set("rent_amount", Number(e.target.value))} className="form-input" /></FormField>
          <FormField label="Deposit (KES)"><input type="number" min={0} value={form.deposit ?? 0} onChange={(e) => set("deposit", Number(e.target.value))} className="form-input" /></FormField>
          <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-glow disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
        <style>{`.form-input{width:100%;border-radius:.5rem;border:1px solid var(--color-border);background:var(--color-card);padding:.5rem .75rem;font-size:.875rem;outline:none}.form-input:focus{border-color:var(--color-ring);box-shadow:0 0 0 3px oklch(0.45 0.1 165/.15)}`}</style>
      </div>
    </div>
  );
}

function FormField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="mb-1 block text-xs font-medium text-foreground">{label}</span>{children}</label>;
}
