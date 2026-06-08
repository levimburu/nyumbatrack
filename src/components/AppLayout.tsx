import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, Receipt, BarChart3, LogOut, Building2, Menu, X, User as UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/hooks/use-auth";

interface NavItem { to: string; label: string; icon: typeof Users; }

const adminNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tenants", label: "Tenants", icon: Users },
  { to: "/payments", label: "Payments", icon: Receipt },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

const tenantNav: NavItem[] = [
  { to: "/portal", label: "My Rent", icon: LayoutDashboard },
];

export function AppLayout({ children, role, email }: { children: ReactNode; role: AppRole; email?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = role === "admin" ? adminNav : tenantNav;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const Sidebar = (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-6 py-6">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gold text-gold-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="font-display text-lg font-semibold tracking-tight">RentLedger</div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold">
            <UserIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{email ?? "Signed in"}</div>
            <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">{role}</div>
          </div>
          <button onClick={handleSignOut} className="text-sidebar-foreground/60 hover:text-sidebar-foreground" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop */}
      <div className="hidden md:block">{Sidebar}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">{Sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="font-display font-semibold">RentLedger</div>
          <div className="w-5" />
          {mobileOpen && (
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-4 top-3 z-50">
              <X className="h-5 w-5 text-sidebar-foreground" />
            </button>
          )}
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
