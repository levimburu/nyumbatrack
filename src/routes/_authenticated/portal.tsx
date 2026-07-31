import { createFileRoute } from "@tanstack/react-router";
import { formatKES } from "@/lib/format";
import { outstandingForDueMonth } from "@/lib/reminders";
import { Home, Wallet, Calendar, Building2, Phone, Mail, CheckCircle2, AlertCircle, Shield, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMyTenant } from "@/hooks/use-my-tenant";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef } from "react";

export const Route = createFileRoute("/_authenticated/portal")({
  component: TenantHome,
});

function TenantHome() {
  const { tenant, payments, avatarUrl, refetchAvatar } = useMyTenant();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // TenantShell already gates on "no linked tenant" before rendering any
  // page, so by the time we're here tenant is guaranteed to exist.
  if (!tenant) return null;

  // The real amount owed, calculated the same way the rest of the app
  // does — tenants.balance itself is never kept in sync with payments, so
  // it's never read directly here.
  const { due, status } = outstandingForDueMonth(tenant.rent_amount, tenant.next_due_date, payments);
  const isOverdue = tenant.next_due_date && new Date(tenant.next_due_date) < new Date() && due > 0;
  const firstName = tenant.full_name?.split(" ")[0];
  const initials = tenant.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  const balanceColor = status === "paid" ? "#16A34A" : status === "partial" ? "#D97706" : "#DC2626";
  const balanceChipBg = status === "paid" ? "#DCFCE7" : status === "partial" ? "#FEF3C7" : "#FEE2E2";

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
      {/* Header */}
      <div className="card-surface overflow-hidden">
        <div className="p-6 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d2818 0%, #166534 100%)" }}>
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10 pointer-events-none" style={{ background: "#F59E0B", transform: "translate(30%, -30%)" }} />
          <div className="absolute bottom-0 left-0 w-28 h-28 rounded-full opacity-10 pointer-events-none" style={{ background: "#16A34A", transform: "translate(-30%, 30%)" }} />
          <div className="relative flex items-center gap-4">
            <button
              onClick={handleAvatarClick}
              disabled={uploadingAvatar}
              className="relative grid h-16 w-16 place-items-center rounded-2xl text-xl font-bold text-white flex-shrink-0 overflow-hidden"
              style={{ background: avatarUrl ? "transparent" : "#F59E0B" }}
              aria-label="Change profile photo"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Your photo" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                {uploadingAvatar ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Camera className="h-5 w-5 text-white" />}
              </div>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            <div>
              <h1 className="font-display text-2xl font-bold text-white">Hello, {firstName}!</h1>
              <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>Unit {tenant.unit}</p>
            </div>
          </div>
        </div>

        {/* Property info */}
        {tenant.properties && (
          <div className="px-6 py-3 border-b border-border flex items-center gap-2 text-sm text-muted-foreground bg-white">
            <Building2 className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium text-foreground">{tenant.properties.name}</span>
            {tenant.properties.location && <span>· {tenant.properties.location}</span>}
          </div>
        )}

        {/* Tenant details — email/phone are tappable since they can be
            longer than the card is wide; tapping shows the full value. */}
        <div className="grid grid-cols-2 gap-px bg-border">
          {tenant.email && (
            <button
              onClick={() => toast.info(tenant.email!, { duration: 5000 })}
              className="p-4 bg-white flex items-start gap-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#EFF6FF" }}>
                <Mail className="h-4 w-4" style={{ color: "#2563EB" }} />
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
              className="p-4 bg-white flex items-start gap-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#DCFCE7" }}>
                <Phone className="h-4 w-4" style={{ color: "#16A34A" }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Phone</div>
                <div className="text-sm font-semibold truncate">{tenant.phone}</div>
              </div>
            </button>
          )}
          {tenant.move_in_date && (
            <div className="p-4 bg-white flex items-start gap-3">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#EDE9FE" }}>
                <Calendar className="h-4 w-4" style={{ color: "#6D28D9" }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Move-in Date</div>
                <div className="text-sm font-semibold">{tenant.move_in_date}</div>
              </div>
            </div>
          )}
          <div className="p-4 bg-white flex items-start gap-3">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#FEF3C7" }}>
              <Home className="h-4 w-4" style={{ color: "#D97706" }} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Monthly Rent</div>
              <div className="text-sm font-semibold">{formatKES(tenant.rent_amount)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Balance + next due — due amount comes from real payment history,
          not the stale tenants.balance column. */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground">Current Balance</span>
            <div className="grid h-8 w-8 place-items-center rounded-lg flex-shrink-0" style={{ background: balanceChipBg }}>
              {status === "paid" ? <CheckCircle2 className="h-4 w-4" style={{ color: balanceColor }} /> : <AlertCircle className="h-4 w-4" style={{ color: balanceColor }} />}
            </div>
          </div>
          <div className="font-display text-xl font-bold leading-tight break-words" style={{ color: balanceColor }}>
            {status === "paid" ? "Cleared ✓" : formatKES(due)}
          </div>
          {status === "partial" && <div className="text-xs mt-1" style={{ color: balanceColor }}>Partially paid — balance remaining</div>}
          {status === "unpaid" && <div className="text-xs mt-1" style={{ color: balanceColor }}>{isOverdue ? "Overdue" : "Outstanding"}</div>}
        </div>
        <div className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground">Next Due Date</span>
            <div className="grid h-8 w-8 place-items-center rounded-lg flex-shrink-0" style={{ background: isOverdue ? "#FEE2E2" : "#F0FDF4" }}>
              <Calendar className="h-4 w-4" style={{ color: isOverdue ? "#DC2626" : "#166534" }} />
            </div>
          </div>
          <div className="font-display text-lg font-bold" style={{ color: isOverdue ? "#DC2626" : "#166534" }}>
            {tenant.next_due_date ?? "—"}
          </div>
          {isOverdue && <div className="text-xs mt-1" style={{ color: "#DC2626" }}>Overdue</div>}
        </div>
      </div>

      {/* Pay Rent — real button, but no payment gateway is connected yet,
          so it says so honestly rather than faking a successful payment. */}
      <button
        onClick={() => toast.info("Online payments aren't set up yet — please pay your landlord directly for now.")}
        className="w-full rounded-2xl py-4 text-base font-bold text-white flex items-center justify-center gap-2.5 transition-transform active:scale-[0.98]"
        style={{ background: "linear-gradient(135deg, #166534 0%, #15803d 100%)", boxShadow: "0 8px 20px -6px rgba(22,101,52,0.4)" }}
      >
        <Wallet className="h-5 w-5" /> Pay Rent
      </button>

      {/* Deposit info — always shown now, with an honest fallback instead
          of silently disappearing when there's nothing on file. */}
      <div className="card-surface p-4 flex items-center gap-3">
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#EDE9FE" }}>
          <Shield className="h-4 w-4" style={{ color: "#6D28D9" }} />
        </div>
        <div className="flex-1 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Deposit Held</div>
          <div className="text-sm font-semibold text-foreground">
            {tenant.deposit != null && Number(tenant.deposit) > 0 ? formatKES(tenant.deposit) : "No deposit recorded"}
          </div>
        </div>
      </div>
    </div>
  );
}