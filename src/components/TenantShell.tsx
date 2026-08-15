import { useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, CreditCard, MessageSquare, LogOut, Building2, Bell } from "lucide-react";
import { useMyTenant } from "@/hooks/use-my-tenant";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { toast } from "sonner";

const TABS = [
  { to: "/portal" as const, label: "Home", icon: Home },
  { to: "/portal-payments" as const, label: "Payments", icon: CreditCard },
  { to: "/portal-communications" as const, label: "Communications", icon: MessageSquare },
];

function VerticalNav({ pathname }: { pathname: string }) {
  return (
    <>
      {TABS.map((tab) => {
        const isActive = pathname === tab.to;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150"
            style={isActive ? { background: "#166534", color: "#FFFFFF" } : { color: "#9CA3AF" }}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            {tab.label}
            {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
          </Link>
        );
      })}
    </>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <>
      {TABS.map((tab) => {
        const isActive = pathname === tab.to;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5"
            style={{ color: isActive ? "#166534" : "#9CA3AF" }}
          >
            {isActive && <div className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full" style={{ background: "#166534" }} />}
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
            <span className="text-[11px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function TenantShell({ children, email }: { children: React.ReactNode; email?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tenant, isLoading } = useMyTenant();

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const performSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-white">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#F59E0B" }}>
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-display text-sm font-semibold">NyumbaTrack</span>
          </div>
          <button onClick={() => setConfirmingSignOut(true)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted transition-colors" aria-label="Sign out">
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 text-center">
          <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl" style={{ background: "#DCFCE7" }}>
            <Home className="h-10 w-10" style={{ color: "#166534" }} />
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">Welcome!</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
            Your tenant record hasn't been linked yet. Ask your landlord or agent to share your invite code.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Your email: <span className="font-medium text-foreground">{email}</span>
          </p>
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
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop side nav */}
      <aside className="hidden md:flex h-full w-64 flex-col flex-shrink-0" style={{ background: "#0d2818" }}>
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl shadow-md" style={{ background: "#F59E0B" }}>
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="font-display text-lg font-bold text-white">NyumbaTrack</span>
        </div>
        <nav className="flex-1 min-h-0 space-y-0.5 px-3">
          <VerticalNav pathname={location.pathname} />
        </nav>
        <div className="p-3 mt-2" style={{ borderTop: "1px solid #1a3a28" }}>
          <button
            onClick={() => setConfirmingSignOut(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 hover:text-white"
            style={{ color: "#9CA3AF" }}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col h-full overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-white flex-shrink-0 md:hidden">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#F59E0B" }}>
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-display text-sm font-semibold">NyumbaTrack</span>
          </div>
          <button onClick={() => toast.info("No new notifications yet")} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted transition-colors" aria-label="Notifications">
            <Bell className="h-4 w-4 text-foreground" />
          </button>
        </div>

        <div className="flex-1 px-4 py-6 pb-24 md:pb-6 md:px-8 overflow-y-auto">
          {children}
        </div>

        {/* Bottom tab bar — mobile only */}
        <div
          className="fixed bottom-0 left-0 right-0 bg-white flex items-stretch z-40 md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "0 -4px 20px rgba(0,0,0,0.06)" }}
        >
          <BottomNav pathname={location.pathname} />
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
    </div>
  );
}