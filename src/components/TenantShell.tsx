import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Home, Wallet, MessageSquare, LogOut, Building2 } from "lucide-react";
import { useMyTenant } from "@/hooks/use-my-tenant";
import { supabase } from "@/integrations/supabase/client";

const TABS = [
  { to: "/portal", label: "Home", icon: Home },
  { to: "/portal-payments", label: "Payments", icon: Wallet },
  { to: "/portal-communications", label: "Communications", icon: MessageSquare },
];

export function TenantShell({ children, email }: { children: React.ReactNode; email?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tenant, isLoading } = useMyTenant();

  const handleSignOut = async () => {
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

  // No linked tenant record yet — show the invite-code guidance full-screen,
  // no point showing a bottom nav to pages with nothing behind them.
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
          <button onClick={handleSignOut} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted transition-colors" aria-label="Sign out">
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#F59E0B" }}>
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-sm font-semibold">NyumbaTrack</span>
        </div>
        <button onClick={handleSignOut} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted transition-colors" aria-label="Sign out">
          <LogOut className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Page content — bottom padding clears the fixed tab bar */}
      <div className="flex-1 px-4 py-6 pb-24 overflow-y-auto">
        {children}
      </div>

      {/* Bottom tab bar */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white flex items-stretch z-40"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "0 -4px 20px rgba(0,0,0,0.06)" }}
      >
        {TABS.map((tab) => {
          const isActive = location.pathname === tab.to;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5"
              style={{ color: isActive ? "#166534" : "#9CA3AF" }}
            >
              <div
                className="grid h-7 w-9 place-items-center rounded-full transition-colors"
                style={{ background: isActive ? "#DCFCE7" : "transparent" }}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className="text-[11px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}