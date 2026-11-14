import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { fetchManagedProperties, fetchManagedPropertyIds } from "@/lib/managedProperties";
import { AppearanceSelector } from "@/components/AppearanceSelector";
import { LayoutDashboard, Users, Receipt, BarChart3, Building2, Menu, X, Home, Wallet, Bell, Info, LogOut, Trash2, UserX, Lock, ChevronRight, Grid3x3, Wrench, PieChart, ShieldCheck, Hammer, MessageSquare, FileText, Search, AlertCircle, Clock, Landmark, TrendingUp, DoorOpen } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
import { useState, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/hooks/use-auth";
import { useProperty } from "@/context/PropertyContext";
import { toast } from "sonner";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";

interface NavItem { to: string; label: string; icon: typeof Users; }

const adminNav: NavItem[] = [
  { to: "/portfolio", label: "Portfolio", icon: PieChart },
  { to: "/activity", label: "Activity", icon: Clock },
  { to: "/properties", label: "Properties", icon: Home },
  { to: "/vacancies", label: "Vacancies", icon: DoorOpen },
  { to: "/arrears", label: "Arrears", icon: AlertCircle },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/compliance", label: "Compliance", icon: ShieldCheck },
  { to: "/vendors", label: "Vendors", icon: Hammer },
  { to: "/communications", label: "Communications", icon: MessageSquare },
  { to: "/collections", label: "Collections", icon: TrendingUp },
  { to: "/financials", label: "Financials", icon: Landmark },
  { to: "/statements", label: "Statements", icon: FileText },
];

// Pages that only make sense once a specific property is selected — shown
// nested under "Properties" in the sidebar rather than as their own
// top-level entries, and hidden again once selectedProperty is cleared.
const propertySubNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/units", label: "Units", icon: Grid3x3 },
  { to: "/tenants", label: "Tenants", icon: Users },
  { to: "/payments", label: "Payments", icon: Receipt },
  { to: "/deposits", label: "Deposits", icon: Wallet },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

const tenantNav: NavItem[] = [
  { to: "/portal", label: "My Rent", icon: LayoutDashboard },
];

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

interface Agent {
  agent_id: string;
  profiles: { full_name: string } | null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function AppLayout({ children, role, email, displayName }: {
  children: ReactNode;
  role: AppRole;
  email?: string;
  displayName?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [profileRole, setProfileRole] = useState<string>("landlord");
  const [userId, setUserId] = useState<string | null>(null);
  const { selectedProperty, setSelectedProperty } = useProperty();
  const { data: companyAccess } = useCompanyAccess();
  const companyMemberships = (companyAccess?.memberships ?? []).filter((m) => m.company?.kind === "company");
  const isSuspended = companyMemberships.length > 0 && companyMemberships.every((m) => m.company?.status === "suspended");
  const items: NavItem[] =
    role === "admin"
      ? [
          ...adminNav,
          ...(companyAccess?.isPlatformAdmin ? [{ to: "/owner", label: "Owner console", icon: Building2 }] : []),
          ...(companyAccess?.memberships.some((m) => m.company?.kind === "company") ? [{ to: "/landlords", label: "Landlords", icon: Users }] : []),
          ...(companyAccess?.memberships.some((m) => m.company?.kind === "company") ? [{ to: "/company", label: "Company", icon: Building2 }] : []),
          ...(companyAccess?.officerCompanies.length ? [{ to: "/staff", label: "Staff", icon: Users }, { to: "/access", label: "Access", icon: ShieldCheck }] : []),
        ]
      : tenantNav;

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Quick-glance digest shown at the top of the notification panel — real
  // counts across every property the account can see, fetched only when the
  // panel is actually opened rather than on every page load.
  const [quickSummary, setQuickSummary] = useState<{ paymentsToday: number; openTickets: number; complianceExpiring: number } | null>(null);
  const [quickSummaryLoading, setQuickSummaryLoading] = useState(false);

  useEffect(() => {
    if (!notifOpen || !userId) return;
    setQuickSummaryLoading(true);
    (async () => {
      const propertyIds: string[] = await fetchManagedPropertyIds();

      if (!propertyIds.length) {
        setQuickSummary({ paymentsToday: 0, openTickets: 0, complianceExpiring: 0 });
        setQuickSummaryLoading(false);
        return;
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const in30Days = new Date();
      in30Days.setDate(in30Days.getDate() + 30);
      const in30DaysStr = in30Days.toISOString().slice(0, 10);

      const { data: tenantRows } = await (supabase as any)
        .from("tenants")
        .select("id")
        .in("property_id", propertyIds);
      const tenantIds = (tenantRows ?? []).map((t: any) => t.id);

      const [{ count: paymentsToday }, { count: openTickets }, { count: complianceExpiring }] = await Promise.all([
        tenantIds.length
          ? (supabase as any)
              .from("payments")
              .select("id", { count: "exact", head: true })
              .eq("paid_on", todayStr)
              .in("tenant_id", tenantIds)
          : Promise.resolve({ count: 0 }),
        (supabase as any)
          .from("maintenance_tickets")
          .select("id", { count: "exact", head: true })
          .in("property_id", propertyIds)
          .neq("status", "done"),
        (supabase as any)
          .from("compliance_records")
          .select("id", { count: "exact", head: true })
          .in("property_id", propertyIds)
          .gte("expiry_date", todayStr)
          .lte("expiry_date", in30DaysStr),
      ]);

      setQuickSummary({
        paymentsToday: paymentsToday ?? 0,
        openTickets: openTickets ?? 0,
        complianceExpiring: complianceExpiring ?? 0,
      });
      setQuickSummaryLoading(false);
    })();
  }, [notifOpen, userId, profileRole]);

  const [profileOpen, setProfileOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      const { data } = await (supabase as any)
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.role) setProfileRole(data.role);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const fetchNotifs = async () => {
      const { data } = await (supabase as any)
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setNotifications(data as Notification[]);
    };
    fetchNotifs();

    const interval = setInterval(fetchNotifs, 30000);

    const channel = supabase
      .channel("notifications-channel")
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const n = payload.new as Notification;
          setNotifications((prev) => [n, ...prev]);
          toast(n.title, { description: n.message });
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Check for overdue tenants and create notifications once per day
  useEffect(() => {
    if (!userId || profileRole !== "landlord") return;
    const checkOverdue = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const todayKey = `overdue_notif_${userId}_${today}`;
      // Only run once per day per user
      if (localStorage.getItem(todayKey)) return;

      // Get all properties belonging to this landlord
      const { data: properties } = await (supabase as any)
        .from("properties")
        .select("id")
        .eq("user_id", userId);
      if (!properties?.length) return;

      const propertyIds = properties.map((p: any) => p.id);

      // Get all tenants with a past due date and outstanding balance
      const { data: overdueTenants } = await (supabase as any)
        .from("tenants")
        .select("id, full_name, unit, next_due_date, balance, property_id")
        .in("property_id", propertyIds)
        .lt("next_due_date", today)
        .gt("balance", 0);

      if (!overdueTenants?.length) {
        localStorage.setItem(todayKey, "1");
        return;
      }

      // Create a notification for each overdue tenant, avoiding duplicates
      for (const t of overdueTenants) {
        const { data: existing } = await (supabase as any)
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("type", "overdue")
          .ilike("message", `%${t.full_name}%Unit ${t.unit}%`)
          .gte("created_at", `${today}T00:00:00`)
          .maybeSingle();

        if (existing) continue;

        await (supabase as any).from("notifications").insert({
          user_id: userId,
          title: "Overdue Rent",
          message: `${t.full_name} — Unit ${t.unit} has not paid rent. Due date was ${t.next_due_date}.`,
          type: "overdue",
          read: false,
        });
      }

      localStorage.setItem(todayKey, "1");
    };
    checkOverdue();
  }, [userId, profileRole]);

  useEffect(() => {
    if (!userId || profileRole !== "landlord") return;
    const fetchAgents = async () => {
      const { data } = await (supabase as any)
        .from("agent_landlord")
        .select("agent_id, profiles:agent_id(full_name)")
        .eq("landlord_id", userId);
      if (data) setAgents(data as Agent[]);
    };
    fetchAgents();
  }, [userId, profileRole]);

  const markAllRead = async () => {
    if (!userId) return;
    await (supabase as any)
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = async (id: string) => {
    await (supabase as any)
      .from("notifications")
      .update({ read: true })
      .eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const [confirmAction, setConfirmAction] = useState<null | "signout" | "signoutAll" | "delete">(null);

  const handleSignOut = () => setConfirmAction("signout");
  const performSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const handleDeleteAccount = () => setConfirmAction("delete");
  const performDeleteAccount = async () => {
    try {
      await supabase.auth.signOut();
      toast.success("Account deleted.");
      navigate({ to: "/auth", replace: true });
    } catch {
      toast.error("Failed to delete account. Contact support.");
    }
  };

  const handleDisconnectAgent = async (agentId: string) => {
    if (!confirm("Disconnect this property manager from your properties?")) return;
    const { error } = await (supabase as any)
      .from("agent_landlord")
      .delete()
      .eq("agent_id", agentId)
      .eq("landlord_id", userId);
    if (error) { toast.error("Failed to disconnect property manager"); return; }
    setAgents((prev) => prev.filter((a) => a.agent_id !== agentId));
    toast.success("Property manager disconnected");
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated!");
    setChangingPassword(false);
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSignOutAllDevices = () => setConfirmAction("signoutAll");
  const performSignOutAllDevices = async () => {
    await supabase.auth.signOut({ scope: "global" });
    navigate({ to: "/auth", replace: true });
  };

  const handleConfirmedAction = async () => {
    if (confirmAction === "signout") await performSignOut();
    else if (confirmAction === "signoutAll") await performSignOutAllDevices();
    else if (confirmAction === "delete") await performDeleteAccount();
    setConfirmAction(null);
  };


  const handleBackToProperties = () => {
    setSelectedProperty(null);
    navigate({ to: "/properties" });
  };

  // Dispatches a "Settings" search result to the real handler/panel section
  // it represents — found through search, but still going through each
  // action's existing behavior (including confirm() dialogs) rather than
  // bypassing any of it.
  const handleSearchAction = (action: string) => {
    if (action === "signout") { handleSignOut(); return; }
    if (action === "signout_all") { handleSignOutAllDevices(); return; }
    if (action === "delete_account") { handleDeleteAccount(); return; }
    if (action === "change_password") { setProfileOpen(true); setChangingPassword(true); return; }
    if (action === "connected_agents") { setProfileOpen(true); return; }
  };

  const displayLabel = displayName || email || "User";
  const initials = displayLabel.charAt(0).toUpperCase();
  const roleLabel =
    profileRole === "agent" ? "Property Manager" : companyAccess?.officerCompanies.length ? "Senior Officer" : "Landlord";

  const notifTypeColor = (type: string): string => {
    if (type === "payment") return "var(--k-16A34A)";
    if (type === "overdue") return "var(--k-DC2626)";
    if (type === "warning") return "var(--k-D97706)";
    return "var(--k-2563EB)";
  };

  const notifTypeBg = (type: string): string => {
    if (type === "payment") return "var(--k-DCFCE7)";
    if (type === "overdue") return "var(--k-FEE2E2)";
    if (type === "warning") return "var(--k-FEF9C3)";
    return "var(--k-EFF6FF)";
  };

  const timeAgo = (date: string): string => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const Sidebar = (
    <aside className="flex h-full w-64 flex-col" style={{ background: "var(--k-0D2818)" }}>
      <button
        onClick={handleBackToProperties}
        className="flex items-center gap-3 px-5 py-5 hover:opacity-80 transition-opacity w-full text-left"
      >
        <div className="grid h-9 w-9 place-items-center rounded-xl shadow-md" style={{ background: "var(--k-F59E0B)" }}>
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <span className="font-display text-lg font-bold text-white">NyumbaTrack</span>
      </button>

      {selectedProperty && role === "admin" && (
        <div className="mx-4 mb-3 rounded-xl px-3 py-2.5" style={{ background: "var(--k-1A3A28)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--kt-6B9E7A)" }}>Current Property</div>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" style={{ color: "var(--kt-F59E0B)" }} />
            <span className="text-sm font-semibold text-white truncate">{selectedProperty.name}</span>
          </div>
          {selectedProperty.location && (
            <div className="text-xs mt-0.5 truncate" style={{ color: "var(--kt-6B9E7A)" }}>{selectedProperty.location}</div>
          )}
        </div>
      )}

      <nav className="flex-1 min-h-0 overflow-y-auto space-y-0.5 px-3 sidebar-nav-scroll">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          const isPropertiesLink = it.to === "/properties";
          const showSubNav = isPropertiesLink && !!selectedProperty && role === "admin";
          return (
            <div key={it.to}>
              <Link
                to={it.to}
                onClick={() => {
                  setMobileOpen(false);
                  // Going back to the properties list should also clear the
                  // current selection, so the sub-pages below hide again
                  // until another property is chosen.
                  if (isPropertiesLink) setSelectedProperty(null);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active ? "text-white font-semibold" : "hover:text-white"
                )}
                style={active ? { background: "var(--k-166534)", color: "var(--kt-FFFFFF)" } : { color: "var(--kt-9CA3AF)" }}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {it.label}
                {active && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
              </Link>

              {showSubNav && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-3" style={{ borderColor: "var(--k-1A3A28)" }}>
                  {propertySubNav.map((sub) => {
                    const subActive = pathname === sub.to;
                    const SubIcon = sub.icon;
                    return (
                      <Link
                        key={sub.to}
                        to={sub.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                          subActive ? "text-white font-semibold" : "hover:text-white"
                        )}
                        style={subActive ? { background: "var(--k-166534)", color: "var(--kt-FFFFFF)" } : { color: "var(--kt-8CA396)" }}
                      >
                        <SubIcon className="h-3.5 w-3.5 flex-shrink-0" />
                        {sub.label}
                        {subActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-3 mt-2" style={{ borderTop: "1px solid var(--k-1A3A28)" }}>
        <button
          onClick={() => setProfileOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:opacity-80 transition-opacity"
          style={{ background: "var(--k-1A3A28)" }}
        >
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white flex-shrink-0"
            style={{ background: "var(--k-F59E0B)" }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-xs font-medium text-white">{displayName || email || "User"}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--kt-6B9E7A)" }}>{roleLabel}</div>
          </div>
          <Info className="h-4 w-4 flex-shrink-0" style={{ color: "var(--kt-6B9E7A)" }} />
        </button>

        <div className="mt-3 px-1">
          <div className="text-[9px] leading-relaxed" style={{ color: "var(--kt-4A7A5A)" }}>
            <div className="font-semibold" style={{ color: "var(--kt-6B9E7A)" }}>NyumbaTrack Technologies Ltd</div>
            <div>© 2026 All rights reserved</div>
            <div>Built for Kenyan landlords</div>
          </div>
        </div>
      </div>

      <style>{`
        .sidebar-nav-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(107, 158, 122, 0.5) transparent;
        }
        .sidebar-nav-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .sidebar-nav-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidebar-nav-scroll::-webkit-scrollbar-thumb {
          background: rgba(107, 158, 122, 0.5);
          border-radius: 999px;
        }
        .sidebar-nav-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(107, 158, 122, 0.8);
        }
        .sidebar-nav-scroll::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }
      `}</style>
    </aside>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div className="hidden md:block h-full">{Sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 animate-slide-up">{Sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col h-full overflow-hidden">
        {/* Desktop top bar */}
        <header className="hidden md:flex items-center justify-between border-b border-border bg-card px-6 py-3">
          <div className="flex-shrink-0">
            <p className="text-sm font-semibold text-foreground">{getGreeting()}, {(displayName || "there").split(" ")[0]}</p>
            <p className="text-xs text-muted-foreground">{getTodayDate()}</p>
          </div>
          <div className="flex items-center gap-4">
            {role === "admin" && (
              <div className="w-72">
                <GlobalSearch isAgent={profileRole === "agent"} onAction={handleSearchAction} />
              </div>
            )}
            <button
              onClick={() => setNotifOpen(true)}
              className="relative grid h-9 w-9 flex-shrink-0 place-items-center rounded-full hover:opacity-80 transition-opacity"
              style={{ background: "var(--k-F59E0B)" }}
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4 text-white" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: "var(--k-DC2626)" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "var(--k-F59E0B)" }}>
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-display font-bold text-foreground">
              {selectedProperty ? selectedProperty.name : "NyumbaTrack"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {role === "admin" && (
              <button
                onClick={() => setMobileSearchOpen(true)}
                className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted transition-colors"
                aria-label="Search"
              >
                <Search className="h-4 w-4 text-foreground" />
              </button>
            )}
            <button
              onClick={() => setNotifOpen(true)}
              className="relative grid h-8 w-8 place-items-center rounded-full"
              style={{ background: "var(--k-F59E0B)" }}
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4 text-white" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: "var(--k-DC2626)" }}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
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

        <main className="flex-1 overflow-y-auto p-4 md:px-8 md:py-5 animate-fade-in">
          {isSuspended ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-6 text-center">
              <h2 className="font-display text-xl font-bold">Account suspended</h2>
              <p className="mt-2 text-sm text-muted-foreground">Your company's NyumbaTrack account is suspended. Your data is safe. Please contact NyumbaTrack to restore access.</p>
            </div>
          ) : children}
        </main>
      </div>

      {/* MOBILE SEARCH OVERLAY — full-screen since the mobile header has no
          room for an inline search bar the way the desktop one does. */}
      {mobileSearchOpen && createPortal(
        <div className="fixed inset-0 z-50 bg-card flex flex-col md:hidden">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex-1">
              <GlobalSearch isAgent={profileRole === "agent"} autoFocus onNavigate={() => setMobileSearchOpen(false)} onAction={handleSearchAction} />
            </div>
            <button onClick={() => setMobileSearchOpen(false)} aria-label="Close search">
              <X className="h-5 w-5 text-foreground" />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* NOTIFICATIONS PANEL */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setNotifOpen(false)}
          />
          <div className="relative w-full max-w-sm h-full bg-card flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">Notifications</h2>
                {unreadCount > 0 && (
                  <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs font-medium px-2.5 py-1 rounded-lg"
                    style={{ background: "var(--k-DCFCE7)", color: "var(--kt-166534)" }}
                  >
                    Mark all read
                  </button>
                )}
                <button onClick={() => setNotifOpen(false)}>
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Quick summary — real counts, fetched fresh each time the
                  panel opens, not a live-updating dashboard. */}
              {quickSummaryLoading ? (
                <div className="px-5 py-4 border-b border-border text-xs text-muted-foreground">Loading summary…</div>
              ) : quickSummary && (quickSummary.paymentsToday > 0 || quickSummary.openTickets > 0 || quickSummary.complianceExpiring > 0) ? (
                <div className="px-5 py-4 border-b border-border" style={{ background: "var(--k-F5F5F0)" }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Quick Summary</div>
                  <ul className="space-y-1 text-sm text-foreground">
                    {quickSummary.paymentsToday > 0 && (
                      <li>{quickSummary.paymentsToday} rent payment{quickSummary.paymentsToday === 1 ? "" : "s"} received today</li>
                    )}
                    {quickSummary.openTickets > 0 && (
                      <li>{quickSummary.openTickets} maintenance ticket{quickSummary.openTickets === 1 ? "" : "s"} still open</li>
                    )}
                    {quickSummary.complianceExpiring > 0 && (
                      <li>{quickSummary.complianceExpiring} compliance record{quickSummary.complianceExpiring === 1 ? "" : "s"} expiring within 30 days</li>
                    )}
                  </ul>
                </div>
              ) : null}

              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div
                    className="grid h-16 w-16 place-items-center rounded-2xl mb-4"
                    style={{ background: "var(--k-F5F5F0)" }}
                  >
                    <Bell className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-foreground mb-1">No notifications yet</p>
                  <p className="text-sm text-muted-foreground">
                    You'll see alerts here for payments, overdue rent, and more.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className="flex items-start gap-3 px-5 py-4 border-b border-border cursor-pointer hover:bg-muted/30 transition-colors"
                    style={{ background: n.read ? "transparent" : "var(--k-F0FDF4)" }}
                  >
                    <div
                      className="grid h-9 w-9 place-items-center rounded-xl flex-shrink-0 mt-0.5"
                      style={{ background: notifTypeBg(n.type) }}
                    >
                      <Bell className="h-4 w-4" style={{ color: notifTypeColor(n.type) }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{n.title}</p>
                        {!n.read && (
                          <div
                            className="h-2 w-2 rounded-full flex-shrink-0 mt-1.5"
                            style={{ background: "var(--k-166534)" }}
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* PROFILE & SETTINGS PANEL */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setProfileOpen(false)}
          />
          <div className="relative w-full max-w-sm h-full bg-card flex flex-col shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display text-lg font-bold text-foreground">Profile & Settings</h2>
              <button onClick={() => setProfileOpen(false)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* Profile card */}
            <div className="px-5 py-5 border-b border-border">
              <div className="flex items-center gap-4">
                <div
                  className="grid h-14 w-14 place-items-center rounded-2xl text-xl font-bold text-white flex-shrink-0"
                  style={{ background: "var(--k-F59E0B)" }}
                >
                  {initials}
                </div>
                <div>
                  <div className="font-display font-bold text-foreground">{displayName || "User"}</div>
                  <div className="text-sm text-muted-foreground">{email}</div>
                  <div
                    className="mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ background: "var(--k-DCFCE7)", color: "var(--kt-166534)" }}
                  >
                    {roleLabel}
                  </div>
                </div>
              </div>
            </div>

            {/* Change Password */}
            <div className="px-5 py-4 border-b border-border">
              <button
                onClick={() => setChangingPassword(!changingPassword)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "var(--k-FEF9C3)" }}>
                    <Lock className="h-4 w-4" style={{ color: "var(--kt-D97706)" }} />
                  </div>
                  <span className="text-sm font-medium text-foreground">Change Password</span>
                </div>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground transition-transform"
                  style={{ transform: changingPassword ? "rotate(90deg)" : "rotate(0deg)" }}
                />
              </button>
              {changingPassword && (
                <div className="mt-3 space-y-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none"
                    style={{ borderColor: "var(--k-E5E7EB)" }}
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none"
                    style={{ borderColor: "var(--k-E5E7EB)" }}
                  />
                  <button
                    onClick={handleChangePassword}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                    style={{ background: "var(--k-166534)" }}
                  >
                    Save Password
                  </button>
                </div>
              )}
            </div>

            {/* Connected property managers (landlords only) */}
            {profileRole === "landlord" && (
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-center gap-3 mb-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "var(--k-F5F5F0)" }}>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium text-foreground">Connected Property Managers</span>
                </div>
                {agents.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-12">No property managers connected.</p>
                ) : (
                  agents.map((a) => (
                    <div key={a.agent_id} className="flex items-center justify-between pl-12 py-1.5">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {a.profiles?.full_name ?? "Property Manager"}
                        </div>
                        <div className="text-xs text-muted-foreground">Property Manager</div>
                      </div>
                      <button
                        onClick={() => handleDisconnectAgent(a.agent_id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-red-600 transition-colors"
                        title="Disconnect property manager"
                      >
                        <UserX className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Appearance */}
            <div className="px-5 py-4 border-b border-border">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Appearance</p>
              <AppearanceSelector />
            </div>

            {/* Privacy Policy */}
            <div className="px-5 py-4 border-b border-border">
              <a href="/privacy" target="_blank" rel="noreferrer" className="w-full flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "var(--k-F5F5F0)" }}>
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium text-foreground">Privacy Policy</span>
              </a>
            </div>

            {/* Sign out all devices */}
            <div className="px-5 py-4 border-b border-border">
              <button onClick={handleSignOutAllDevices} className="w-full flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "var(--k-F5F5F0)" }}>
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium text-foreground">Sign out of all devices</span>
              </button>
            </div>

            {/* Danger zone */}
            <div className="px-5 py-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Danger Zone
              </p>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 rounded-xl px-4 py-3 border border-border hover:bg-muted transition-colors"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Sign Out</span>
              </button>
              <button
                onClick={handleDeleteAccount}
                className="w-full flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--k-FEE2E2)" }}
              >
                <Trash2 className="h-4 w-4" style={{ color: "var(--kt-DC2626)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--kt-DC2626)" }}>
                  Delete Account
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction === "delete" ? "Delete your account?" :
            confirmAction === "signoutAll" ? "Sign out from all devices?" :
            "Sign out?"
          }
          message={
            confirmAction === "delete" ? "This permanently deletes your account and all of your data. This cannot be undone." :
            confirmAction === "signoutAll" ? "You'll be signed out on every device where you're currently logged in, not just this one." :
            "You'll need to sign in again to access your account."
          }
          confirmLabel={confirmAction === "delete" ? "Delete Account" : "Sign Out"}
          danger={confirmAction === "delete"}
          onConfirm={handleConfirmedAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}