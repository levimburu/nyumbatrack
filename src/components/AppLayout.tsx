import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, Receipt, BarChart3, LogOut, Building2, Menu, X, Home } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/hooks/use-auth";
import { useProperty } from "@/context/PropertyContext";

interface NavItem { to: string; label: string; icon: typeof Users; }

const adminNav: NavItem[] = [
  { to: "/properties", label: "Properties", icon: Home },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tenants", label: "Tenants", icon: Users },
  { to: "/payments", label: "Payments", icon: Receipt },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

const tenantNav: NavItem[] = [
  { to: "/portal", label: "My Rent", icon: LayoutDashboard },
];

export function AppLayout({ children, role, email, displayName }: {
  children: ReactNode;
  role: AppRole;
  email?: string;
  displayName?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileRole, setProfileRole] = useState<string>("landlord");
  const { selectedProperty, setSelectedProperty } = useProperty();
  const items = role === "admin" ? adminNav : tenantNav;

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.role) setProfileRole(data.role);
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const handleBackToProperties = () => {
    setSelectedProperty(null);
    navigate({ to: "/properties" });
  };

  const displayLabel = displayName || email || "User";
  const initials = displayLabel.charAt(0).toUpperCase();
  const roleLabel = profileRole === "agent" ? "Agent" : "Landlord";

  const Sidebar = (
    <aside className="flex h-full w-64 flex-col" style={{ background: "#0d2818" }}>
      {/* Logo */}
      <button
        onClick={handleBackToProperties}
        className="flex items-center gap-3 px-5 py-5 hover:opacity-80 transition-opacity w-full text-left"
      >
        <div className="grid h-9 w-9 place-items-center rounded-xl shadow-md" style={{ background: "#F59E0B" }}>
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <span className="font-display text-lg font-bold text-white">NyumbaTrack</span>
      </button>

      {/* Current property indicator */}
      {selectedProperty && role === "admin" && (
        <div className="mx-4 mb-3 rounded-xl px-3 py-2.5" style={{ background: "#1a3a28" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#6B9E7A" }}>Current Property</div>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" style={{ color: "#F59E0B" }} />
            <span className="text-sm font-semibold text-white truncate">{selectedProperty.name}</span>
          </div>
          {selectedProperty.location && (
            <div className="text-xs mt-0.5 truncate" style={{ color: "#6B9E7A" }}>{selectedProperty.location}</div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                active ? "text-white font-semibold" : "hover:text-white"
              )}
              style={active
                ? { background: "#166534", color: "#FFFFFF" }
                : { color: "#9CA3AF" }
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {it.label}
              {active && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-3 mt-2" style={{ borderTop: "1px solid #1a3a28" }}>
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "#1a3a28" }}>
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white flex-shrink-0"
            style={{ background: "#F59E0B" }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-white">{displayName || email || "User"}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#6B9E7A" }}>{roleLabel}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="hover:text-white transition-colors"
            style={{ color: "#6B9E7A" }}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Copyright footer */}
        <div className="mt-3 px-1">
          <div className="text-[9px] leading-relaxed" style={{ color: "#4a7a5a" }}>
            <div className="font-semibold" style={{ color: "#6B9E7A" }}>NyumbaTrack Technologies Ltd</div>
            <div>© 2026 All rights reserved</div>
            <div>Built for Kenyan landlords</div>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="hidden md:block">{Sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 animate-slide-up">{Sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex items-center justify-between border-b border-border bg-white px-4 py-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "#F59E0B" }}>
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-display font-bold text-foreground">
              {selectedProperty ? selectedProperty.name : "NyumbaTrack"}
            </span>
          </div>
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white"
            style={{ background: "#F59E0B" }}
          >
            {initials}
          </div>
          {mobileOpen && (
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-4 top-3 z-50"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          )}
        </header>

        <main className="flex-1 p-4 md:p-8 animate-fade-in">{children}</main>
      </div>
    </div>
  );
}