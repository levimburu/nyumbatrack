import { createFileRoute } from "@tanstack/react-router";
import { formatKES } from "@/lib/format";
import { Home, Wallet, Calendar, Building2, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import { useMyTenant } from "@/hooks/use-my-tenant";

export const Route = createFileRoute("/_authenticated/portal")({
  component: TenantHome,
});

function TenantHome() {
  const { data: tenant } = useMyTenant();

  // TenantShell already gates on "no linked tenant" before rendering any
  // page, so by the time we're here tenant is guaranteed to exist.
  if (!tenant) return null;

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

      {/* Pay Rent — real button, but no payment gateway is connected yet,
          so it says so honestly rather than faking a successful payment. */}
      <button
        onClick={() => toast.info("Online payments aren't set up yet — please pay your landlord directly for now.")}
        className="w-full rounded-xl py-3.5 text-base font-bold text-white flex items-center justify-center gap-2"
        style={{ background: "#166534" }}
      >
        <Wallet className="h-5 w-5" /> Pay Rent
      </button>

      {/* Deposit info */}
      {tenant.deposit != null && Number(tenant.deposit) > 0 && (
        <div className="card-surface p-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Deposit Held</div>
          <div className="text-sm font-semibold text-foreground">{formatKES(tenant.deposit)}</div>
        </div>
      )}
    </div>
  );
}