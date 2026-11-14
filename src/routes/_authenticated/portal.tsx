import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatKES } from "@/lib/format";
import { outstandingForDueMonth } from "@/lib/reminders";
import { AppearanceSelector } from "@/components/AppearanceSelector";
import { Home, Calendar, Building2, Phone, Mail, CheckCircle2, AlertCircle, Shield, Camera, Loader2, ChevronDown, ChevronRight, ArrowRight, Receipt, Wrench, MessageCircle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useMyTenant } from "@/hooks/use-my-tenant";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/_authenticated/portal")({
  component: TenantHome,
});

interface TicketMin {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const ticketStatusLabel: Record<string, string> = { open: "Open", in_progress: "In Progress", done: "Done" };
const ticketStatusColor: Record<string, string> = { open: "var(--k-DC2626)", in_progress: "var(--k-D97706)", done: "var(--k-16A34A)" };

function TenantHome() {
  const navigate = useNavigate();
  const { tenant, payments, avatarUrl, refetchAvatar } = useMyTenant();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [leaseFundsOpen, setLeaseFundsOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recent maintenance requests this tenant submitted, to merge into the
  // activity feed alongside payments — matches Home in Progress ‧ #1234
  // style, using the ticket's real title since there's no ticket-number
  // system in the schema.
  //
  // This hook must run on every render, before any early return below —
  // React requires the same hooks in the same order every time. Guard
  // with `enabled` instead of skipping the call entirely.
  const { data: tickets } = useQuery({
    queryKey: ["portal-recent-tickets", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_tickets")
        .select("id, title, status, created_at")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data as TicketMin[];
    },
  });

  // TenantShell already gates on "no linked tenant" before rendering any
  // page, so by the time we're here tenant is guaranteed to exist — but
  // the check has to come after every hook above it, not before.
  if (!tenant) return null;

  // The real amount owed, calculated the same way the rest of the app
  // does — tenants.balance itself is never kept in sync with payments, so
  // it's never read directly here.
  const { due, status } = outstandingForDueMonth(tenant.rent_amount, tenant.next_due_date, payments);
  const isOverdue = tenant.next_due_date && new Date(tenant.next_due_date) < new Date() && due > 0;
  const firstName = tenant.full_name?.split(" ")[0];
  const initials = tenant.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const balanceColor = status === "paid" ? "var(--k-16A34A)" : isOverdue ? "var(--k-DC2626)" : "var(--k-F59E0B)";
  const dueBadge = status === "paid" ? null : isOverdue ? { label: "Overdue", bg: "var(--k-FEE2E2)", fg: "var(--k-DC2626)" } : { label: "Due Soon", bg: "var(--k-F59E0B)", fg: "var(--k-78350F)" };

  // Recent Activity — payments and maintenance requests merged into one
  // feed, newest first, capped to the 4 most recent items total.
  const activity = [
    ...payments.slice(0, 5).map((p) => ({
      kind: "payment" as const,
      date: p.paid_on,
      title: p.payment_month ? `Rent for ${p.payment_month}` : "Rent payment",
      subtitle: `Paid on ${new Date(p.paid_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
      amount: p.amount,
    })),
    ...(tickets ?? []).map((t) => ({
      kind: "ticket" as const,
      date: t.created_at,
      title: t.title,
      subtitle: ticketStatusLabel[t.status] ?? t.status,
      statusColor: ticketStatusColor[t.status] ?? "var(--k-6B7280)",
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4);

  const performSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await (supabase as any)
        .from("profiles")
        .update({ avatar_url: `${urlData.publicUrl}?t=${Date.now()}` })
        .eq("id", user.id);
      if (updateError) throw updateError;
      toast.success("Photo updated!");
      refetchAvatar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload photo");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Greeting row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setAvatarMenuOpen((v) => !v)}
              disabled={uploadingAvatar}
              className="relative grid h-12 w-12 place-items-center rounded-2xl text-sm font-bold text-white flex-shrink-0 overflow-hidden"
              style={{ background: avatarUrl ? "transparent" : "var(--k-F59E0B)" }}
              aria-label="Account menu"
            >
              {avatarUrl ? <img src={avatarUrl} alt="Your photo" className="h-full w-full object-cover" /> : initials}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                {uploadingAvatar ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" />}
              </div>
            </button>
            {avatarMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAvatarMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-2 w-60 rounded-xl border border-border bg-card py-1.5 shadow-lg z-40">
                  <button
                    onClick={() => { setAvatarMenuOpen(false); handleAvatarClick(); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-muted text-left"
                  >
                    <Camera className="h-4 w-4 text-muted-foreground" /> Change Photo
                  </button>
                  <div className="px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Appearance</p>
                    <AppearanceSelector />
                  </div>
                  <a
                    href="/privacy" target="_blank" rel="noreferrer"
                    onClick={() => setAvatarMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-muted text-left"
                  >
                    <Shield className="h-4 w-4 text-muted-foreground" /> Privacy Policy
                  </a>
                  <button
                    onClick={() => { setAvatarMenuOpen(false); setConfirmingSignOut(true); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-muted text-left"
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground" /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">{greeting}, {firstName} 👋</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Here's what's happening with your home.</p>
          </div>
        </div>
      </div>

      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need to sign in again to access your account."
          confirmLabel="Sign Out"
          onConfirm={performSignOut}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}

      {/* Payment Overview — dark card, matching the amber/green brand
          palette used across the rest of the app. */}
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, var(--k-0D2818) 0%, var(--k-166534) 100%)" }}>
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10 pointer-events-none" style={{ background: "var(--k-F59E0B)", transform: "translate(30%, -30%)" }} />
        <div className="relative flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-white">Payment Overview</h2>
          {dueBadge && (
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: dueBadge.bg, color: dueBadge.fg }}>
              {dueBadge.label}
            </span>
          )}
        </div>
        <div className="relative mb-4">
          <div className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>Rent Balance</div>
          <div className="font-display text-3xl font-bold mt-1" style={{ color: status === "paid" ? "var(--k-FFFFFF)" : balanceColor }}>
            {status === "paid" ? "Cleared ✓" : formatKES(due)}
          </div>
        </div>
        <div className="relative flex items-center justify-between pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          <div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>Due Date</div>
            <div className="text-sm font-bold text-white mt-0.5">{tenant.next_due_date ?? "—"}</div>
          </div>
          <button
            onClick={() => navigate({ to: "/portal-payments" })}
            className="flex items-center gap-1 rounded-full px-3.5 py-2 text-xs font-semibold text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            View Statement <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Pay Rent — real button, but no payment gateway is connected yet,
          so it says so honestly rather than faking a successful payment. */}
      <button
        onClick={() => toast.info("Online payments aren't set up yet — please pay your landlord directly for now.")}
        className="w-full rounded-2xl py-4 text-base font-bold text-white flex items-center justify-center gap-2.5 transition-transform active:scale-[0.98]"
        style={{ background: "linear-gradient(135deg, var(--k-166534) 0%, var(--k-15803D) 100%)", boxShadow: "0 8px 20px -6px rgba(22,101,52,0.4)" }}
      >
        Pay Rent <ArrowRight className="h-5 w-5" />
      </button>

      {/* Recent Activity — payments and maintenance requests merged into
          one feed, newest first. */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-foreground">Recent Activity</h2>
          <button onClick={() => navigate({ to: "/portal-payments" })} className="text-xs font-semibold" style={{ color: "var(--kt-166534)" }}>
            See all
          </button>
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nothing here yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {activity.map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full" style={{ background: item.kind === "payment" ? "var(--k-DCFCE7)" : "var(--k-FEF3C7)" }}>
                  {item.kind === "payment" ? <Receipt className="h-4 w-4" style={{ color: "var(--kt-16A34A)" }} /> : <Wrench className="h-4 w-4" style={{ color: "var(--kt-D97706)" }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">{item.title}</div>
                  <div className="text-xs mt-0.5" style={item.kind === "ticket" ? { color: item.statusColor } : { color: "var(--kt-9CA3AF)" }}>
                    {item.subtitle}
                  </div>
                </div>
                {item.kind === "payment" ? (
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-foreground">{formatKES(item.amount)}</div>
                    <div className="text-xs" style={{ color: "var(--kt-16A34A)" }}>Paid</div>
                  </div>
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Need help — routes to the existing Communications tab, where
          messaging/maintenance reporting already works. */}
      <button
        onClick={() => navigate({ to: "/portal-communications" })}
        className="card-surface p-4 w-full flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
      >
        <div>
          <div className="text-sm font-bold text-foreground">Need help?</div>
          <div className="text-xs text-muted-foreground mt-0.5">Message your property manager</div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold flex-shrink-0" style={{ background: "var(--k-DCFCE7)", color: "var(--kt-166534)" }}>
          <MessageCircle className="h-3.5 w-3.5" /> Message
        </span>
      </button>

      {/* Property + lease details — kept, just moved below the new
          activity-first layout above rather than removed. */}
      <div className="card-surface overflow-hidden">
        {tenant.properties && (
          <div className="px-6 py-4 border-b border-border bg-card flex items-start gap-3">
            <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl" style={{ background: "var(--k-FEF3C7)" }}>
              <Building2 className="h-5 w-5" style={{ color: "var(--kt-D97706)" }} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Your Property</div>
              <div className="font-display font-bold text-foreground truncate">{tenant.properties.name}</div>
              {tenant.properties.location && (
                <div className="text-xs text-muted-foreground mt-0.5">{tenant.properties.location}</div>
              )}
              <div className="text-xs text-muted-foreground mt-0.5">Unit {tenant.unit}</div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-px bg-border">
          {tenant.email && (
            <button
              onClick={() => toast.info(tenant.email!, { duration: 5000 })}
              className="p-4 bg-card flex items-start gap-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "var(--k-EFF6FF)" }}>
                <Mail className="h-4 w-4" style={{ color: "var(--kt-2563EB)" }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm font-semibold truncate">{tenant.email}</div>
              </div>
            </button>
          )}
          {tenant.phone && (
            <button
              onClick={() => toast.info(tenant.phone!, { duration: 5000 })}
              className="p-4 bg-card flex items-start gap-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "var(--k-DCFCE7)" }}>
                <Phone className="h-4 w-4" style={{ color: "var(--kt-16A34A)" }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Phone</div>
                <div className="text-sm font-semibold truncate">{tenant.phone}</div>
              </div>
            </button>
          )}
          {tenant.move_in_date && (
            <div className="p-4 bg-card flex items-start gap-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "var(--k-EDE9FE)" }}>
                <Calendar className="h-4 w-4" style={{ color: "var(--kt-6D28D9)" }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Move-in Date</div>
                <div className="text-sm font-semibold">{tenant.move_in_date}</div>
              </div>
            </div>
          )}
          <div className="p-4 bg-card flex items-start gap-3">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "var(--k-FEF3C7)" }}>
              <Home className="h-4 w-4" style={{ color: "var(--kt-D97706)" }} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Monthly Rent</div>
              <div className="text-sm font-semibold">{formatKES(tenant.rent_amount)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Lease & Funds — collapsible, defaults closed now that it's lower
          on the page and not the first thing a tenant sees. */}
      <div className="card-surface overflow-hidden">
        <button onClick={() => setLeaseFundsOpen(!leaseFundsOpen)} className="w-full flex items-center justify-between p-5">
          <h2 className="font-display font-bold text-foreground">Lease & Funds</h2>
          <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform" style={{ transform: leaseFundsOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
        </button>
        {leaseFundsOpen && (
          <div className="px-5 pb-5 pt-0 border-t border-border">
            <div className="flex items-center gap-3 pt-4">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "var(--k-EDE9FE)" }}>
                <Shield className="h-4 w-4" style={{ color: "var(--kt-6D28D9)" }} />
              </div>
              <div className="flex-1 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Deposit Held</div>
                <div className="text-sm font-semibold text-foreground">
                  {tenant.deposit != null && Number(tenant.deposit) > 0 ? formatKES(tenant.deposit) : "No deposit recorded"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}