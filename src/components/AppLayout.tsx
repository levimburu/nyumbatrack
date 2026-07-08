import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, Receipt, BarChart3, Building2, Menu, X, Home, Wallet, Bell, Info, LogOut, Trash2, UserX, Key, Lock, ChevronRight, Grid3x3 } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/hooks/use-auth";
import { useProperty } from "@/context/PropertyContext";
import { toast } from "sonner";

interface NavItem { to: string; label: string; icon: typeof Users; }

const adminNav: NavItem[] = [
  { to: "/properties", label: "Properties", icon: Home },
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

function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36) + pin.length.toString();
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
  const [profileRole, setProfileRole] = useState<string>("landlord");
  const [userId, setUserId] = useState<string | null>(null);
  const { selectedProperty, setSelectedProperty } = useProperty();
  const items = role === "admin" ? adminNav : tenantNav;

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const [profileOpen, setProfileOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [changingPin, setChangingPin] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPin, setNewPin] = useState("");
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

  const handleSignOut = async () => {
    localStorage.removeItem("nyumbatrack_email");
    localStorage.removeItem("nyumbatrack_user_id");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    if (!confirm("This will delete ALL your data. Final confirmation?")) return;
    try {
      await supabase.auth.signOut();
      toast.success("Account deleted.");
      navigate({ to: "/auth", replace: true });
    } catch {
      toast.error("Failed to delete account. Contact support.");
    }
  };

  const handleDisconnectAgent = async (agentId: string) => {
    if (!confirm("Disconnect this agent from your properties?")) return;
    const { error } = await (supabase as any)
      .from("agent_landlord")
      .delete()
      .eq("agent_id", agentId)
      .eq("landlord_id", userId);
    if (error) { toast.error("Failed to disconnect agent"); return; }
    setAgents((prev) => prev.filter((a) => a.agent_id !== agentId));
    toast.success("Agent disconnected");
  };

  const handleChangePin = async () => {
    if (newPin.length !== 4) { toast.error("PIN must be 4 digits"); return; }
    const pinHash = hashPin(newPin);
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ pin_hash: pinHash })
      .eq("id", userId);
    if (error) { toast.error("Failed to update PIN"); return; }
    if (userId) localStorage.setItem(`nyumbatrack_pin_${userId}`, pinHash);
    toast.success("PIN updated!");
    setChangingPin(false);
    setNewPin("");
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

  const handleSignOutAllDevices = async () => {
    if (!confirm("Sign out from all devices?")) return;
    await supabase.auth.signOut({ scope: "global" });
    localStorage.removeItem("nyumbatrack_email");
    localStorage.removeItem("nyumbatrack_user_id");
    navigate({ to: "/auth", replace: true });
  };

  const handleBackToProperties = () => {
    setSelectedProperty(null);
    navigate({ to: "/properties" });
  };

  const displayLabel = displayName || email || "User";
  const initials = displayLabel.charAt(0).toUpperCase();
  const roleLabel = profileRole === "agent" ? "Agent" : "Landlord";

  const notifTypeColor = (type: string): string => {
    if (type === "payment") return "#16A34A";
    if (type === "overdue") return "#DC2626";
    if (type === "warning") return "#D97706";
    return "#2563EB";
  };

  const notifTypeBg = (type: string): string => {
    if (type === "payment") return "#DCFCE7";
    if (type === "overdue") return "#FEE2E2";
    if (type === "warning") return "#FEF9C3";
    return "#EFF6FF";
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
    <aside className="flex h-full w-64 flex-col" style={{ background: "#0d2818" }}>
      <button
        onClick={handleBackToProperties}
        className="flex items-center gap-3 px-5 py-5 hover:opacity-80 transition-opacity w-full text-left"
      >
        <div className="grid h-9 w-9 place-items-center rounded-xl shadow-md" style={{ background: "#F59E0B" }}>
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <span className="font-display text-lg font-bold text-white">NyumbaTrack</span>
      </button>

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
              style={active ? { background: "#166534", color: "#FFFFFF" } : { color: "#9CA3AF" }}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {it.label}
              {active && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 mt-2" style={{ borderTop: "1px solid #1a3a28" }}>
        <button
          onClick={() => setProfileOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:opacity-80 transition-opacity"
          style={{ background: "#1a3a28" }}
        >
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white flex-shrink-0"
            style={{ background: "#F59E0B" }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-xs font-medium text-white">{displayName || email || "User"}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#6B9E7A" }}>{roleLabel}</div>
          </div>
          <Info className="h-4 w-4 flex-shrink-0" style={{ color: "#6B9E7A" }} />
        </button>

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
        <header className="hidden md:flex items-center justify-between border-b border-border bg-white px-6 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{getGreeting()}, {(displayName || "there").split(" ")[0]}</p>
            <p className="text-xs text-muted-foreground">{getTodayDate()}</p>
          </div>
          <button
            onClick={() => setNotifOpen(true)}
            className="relative grid h-9 w-9 place-items-center rounded-full hover:opacity-80 transition-opacity"
            style={{ background: "#F59E0B" }}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4 text-white" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                style={{ background: "#DC2626" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </header>

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
          <button
            onClick={() => setNotifOpen(true)}
            className="relative grid h-8 w-8 place-items-center rounded-full"
            style={{ background: "#F59E0B" }}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4 text-white" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                style={{ background: "#DC2626" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
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

        <main className="flex-1 overflow-y-auto p-4 md:px-8 md:py-5 animate-fade-in">{children}</main>
      </div>

      {/* NOTIFICATIONS PANEL */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setNotifOpen(false)}
          />
          <div className="relative w-full max-w-sm h-full bg-white flex flex-col shadow-2xl">
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
                    style={{ background: "#DCFCE7", color: "#166534" }}
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
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div
                    className="grid h-16 w-16 place-items-center rounded-2xl mb-4"
                    style={{ background: "#F5F5F0" }}
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
                    style={{ background: n.read ? "transparent" : "#F0FDF4" }}
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
                            style={{ background: "#166534" }}
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
          <div className="relative w-full max-w-sm h-full bg-white flex flex-col shadow-2xl overflow-y-auto">
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
                  style={{ background: "#F59E0B" }}
                >
                  {initials}
                </div>
                <div>
                  <div className="font-display font-bold text-foreground">{displayName || "User"}</div>
                  <div className="text-sm text-muted-foreground">{email}</div>
                  <div
                    className="mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ background: "#DCFCE7", color: "#166534" }}
                  >
                    {roleLabel}
                  </div>
                </div>
              </div>
            </div>

            {/* Change PIN */}
            <div className="px-5 py-4 border-b border-border">
              <button
                onClick={() => setChangingPin(!changingPin)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#EFF6FF" }}>
                    <Key className="h-4 w-4" style={{ color: "#2563EB" }} />
                  </div>
                  <span className="text-sm font-medium text-foreground">Change PIN</span>
                </div>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground transition-transform"
                  style={{ transform: changingPin ? "rotate(90deg)" : "rotate(0deg)" }}
                />
              </button>
              {changingPin && (
                <div className="mt-3 space-y-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="Enter new 4-digit PIN"
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none"
                    style={{ borderColor: "#E5E7EB" }}
                  />
                  <button
                    onClick={handleChangePin}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                    style={{ background: "#166534" }}
                  >
                    Save PIN
                  </button>
                </div>
              )}
            </div>

            {/* Change Password */}
            <div className="px-5 py-4 border-b border-border">
              <button
                onClick={() => setChangingPassword(!changingPassword)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#FEF9C3" }}>
                    <Lock className="h-4 w-4" style={{ color: "#D97706" }} />
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
                    style={{ borderColor: "#E5E7EB" }}
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none"
                    style={{ borderColor: "#E5E7EB" }}
                  />
                  <button
                    onClick={handleChangePassword}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                    style={{ background: "#166534" }}
                  >
                    Save Password
                  </button>
                </div>
              )}
            </div>

            {/* Connected Agents (landlords only) */}
            {profileRole === "landlord" && (
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-center gap-3 mb-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#F5F5F0" }}>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium text-foreground">Connected Agents</span>
                </div>
                {agents.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-12">No agents connected.</p>
                ) : (
                  agents.map((a) => (
                    <div key={a.agent_id} className="flex items-center justify-between pl-12 py-1.5">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {a.profiles?.full_name ?? "Agent"}
                        </div>
                        <div className="text-xs text-muted-foreground">Agent</div>
                      </div>
                      <button
                        onClick={() => handleDisconnectAgent(a.agent_id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-red-600 transition-colors"
                        title="Disconnect agent"
                      >
                        <UserX className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Sign out all devices */}
            <div className="px-5 py-4 border-b border-border">
              <button onClick={handleSignOutAllDevices} className="w-full flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "#F5F5F0" }}>
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
                style={{ background: "#FEE2E2" }}
              >
                <Trash2 className="h-4 w-4" style={{ color: "#DC2626" }} />
                <span className="text-sm font-medium" style={{ color: "#DC2626" }}>
                  Delete Account
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}