import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search, X, Users, Grid3x3, LayoutDashboard, PieChart, Receipt,
  Wallet, Wrench, ShieldCheck, Hammer, MessageSquare, FileText, BarChart3, Home, Building2, AlertCircle, Clock,
  Lock, LogOut, Trash2, Monitor,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProperty } from "@/context/PropertyContext";

interface Property {
  id: string;
  name: string;
  location: string | null;
  user_id: string;
}

interface TenantRow {
  id: string;
  full_name: string;
  unit: string;
  property_id: string;
}

interface UnitRow {
  id: string;
  unit_name: string;
  property_id: string;
}

interface MaintenanceRow {
  id: string;
  title: string;
  status: string;
  property_id: string;
}

interface ComplianceRow {
  id: string;
  type: string;
  document_number: string | null;
  property_id: string;
}

interface VendorRow {
  id: string;
  name: string;
  trade: string | null;
}

interface CommunicationRow {
  id: string;
  tenant_name: string;
  type: string;
  note: string | null;
  property_id: string;
}

// The same destinations as the sidebar's adminNav — letting search act as a
// quick "go to page" shortcut alongside tenant/unit lookups.
const PAGES = [
  { to: "/properties", label: "Properties", icon: Home },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portfolio", label: "Portfolio", icon: PieChart },
  { to: "/activity", label: "Activity", icon: Clock },
  { to: "/units", label: "Units", icon: Grid3x3 },
  { to: "/tenants", label: "Tenants", icon: Users },
  { to: "/arrears", label: "Arrears", icon: AlertCircle },
  { to: "/payments", label: "Payments", icon: Receipt },
  { to: "/deposits", label: "Deposits", icon: Wallet },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/compliance", label: "Compliance", icon: ShieldCheck },
  { to: "/vendors", label: "Vendors", icon: Hammer },
  { to: "/communications", label: "Communications", icon: MessageSquare },
  { to: "/statements", label: "Statements", icon: FileText },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

// Settings/account actions — findable through search the same as pages, but
// these trigger something in the profile panel (via onAction) instead of
// navigating. Destructive ones (sign out, delete account) still go through
// their existing confirm() dialogs — search just finds them, it doesn't
// bypass the safety already built into each action.
const ACTIONS = [
  { key: "change_password", label: "Change Password", icon: Lock },
  { key: "connected_agents", label: "Connected Agents", icon: Users },
  { key: "signout_all", label: "Sign Out of All Devices", icon: Monitor },
  { key: "signout", label: "Sign Out", icon: LogOut },
  { key: "delete_account", label: "Delete Account", icon: Trash2 },
];

export function GlobalSearch({
  isAgent, autoFocus, onNavigate, onAction,
}: {
  isAgent: boolean;
  autoFocus?: boolean;
  onNavigate?: () => void;
  onAction?: (action: string) => void;
}) {
  const navigate = useNavigate();
  const { setSelectedProperty } = useProperty();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantResults, setTenantResults] = useState<(TenantRow & { propertyName: string })[]>([]);
  const [unitResults, setUnitResults] = useState<(UnitRow & { propertyName: string })[]>([]);
  const [maintenanceResults, setMaintenanceResults] = useState<(MaintenanceRow & { propertyName: string })[]>([]);
  const [complianceResults, setComplianceResults] = useState<(ComplianceRow & { propertyName: string })[]>([]);
  const [vendorResults, setVendorResults] = useState<VendorRow[]>([]);
  const [communicationResults, setCommunicationResults] = useState<(CommunicationRow & { propertyName: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Every property this account can see, loaded once — reused on every
  // keystroke rather than re-resolving "which properties can I see" each time.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (isAgent) {
        const { data: links } = await (supabase as any)
          .from("agent_landlord")
          .select("landlord_id")
          .eq("agent_id", user.id);
        const landlordIds = (links ?? []).map((l: any) => l.landlord_id);
        if (!landlordIds.length) return;
        const { data } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id")
          .in("user_id", landlordIds);
        setProperties(data ?? []);
      } else {
        const { data } = await (supabase as any)
          .from("properties")
          .select("id, name, location, user_id")
          .eq("user_id", user.id);
        setProperties(data ?? []);
      }
    })();
  }, [isAgent]);

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Unknown property";

  // Debounced search across every data type, across every accessible property.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || properties.length === 0) {
      setTenantResults([]);
      setUnitResults([]);
      setMaintenanceResults([]);
      setComplianceResults([]);
      setVendorResults([]);
      setCommunicationResults([]);
      return;
    }
    const propertyIds = properties.map((p) => p.id);
    setLoading(true);
    const handle = setTimeout(async () => {
      const [
        { data: tenants }, { data: units }, { data: tickets },
        { data: compliance }, { data: vendors }, { data: comms },
      ] = await Promise.all([
        (supabase as any)
          .from("tenants")
          .select("id, full_name, unit, property_id")
          .in("property_id", propertyIds)
          .or(`full_name.ilike.%${q}%,unit.ilike.%${q}%,phone.ilike.%${q}%`)
          .limit(6),
        (supabase as any)
          .from("units")
          .select("id, unit_name, property_id")
          .in("property_id", propertyIds)
          .ilike("unit_name", `%${q}%`)
          .limit(6),
        (supabase as any)
          .from("maintenance_tickets")
          .select("id, title, status, property_id")
          .in("property_id", propertyIds)
          .ilike("title", `%${q}%`)
          .limit(6),
        (supabase as any)
          .from("compliance_records")
          .select("id, type, document_number, property_id")
          .in("property_id", propertyIds)
          .or(`type.ilike.%${q}%,document_number.ilike.%${q}%`)
          .limit(6),
        (supabase as any)
          .from("vendors")
          .select("id, name, trade")
          .or(`name.ilike.%${q}%,trade.ilike.%${q}%`)
          .limit(6),
        (supabase as any)
          .from("tenant_communications")
          .select("id, tenant_name, type, note, property_id")
          .in("property_id", propertyIds)
          .or(`tenant_name.ilike.%${q}%,note.ilike.%${q}%`)
          .limit(6),
      ]);
      setTenantResults((tenants ?? []).map((t: TenantRow) => ({ ...t, propertyName: propertyName(t.property_id) })));
      setUnitResults((units ?? []).map((u: UnitRow) => ({ ...u, propertyName: propertyName(u.property_id) })));
      setMaintenanceResults((tickets ?? []).map((t: MaintenanceRow) => ({ ...t, propertyName: propertyName(t.property_id) })));
      setComplianceResults((compliance ?? []).map((c: ComplianceRow) => ({ ...c, propertyName: propertyName(c.property_id) })));
      setVendorResults(vendors ?? []);
      setCommunicationResults((comms ?? []).map((c: CommunicationRow) => ({ ...c, propertyName: propertyName(c.property_id) })));
      setLoading(false);
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, properties]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const pageMatches = q ? PAGES.filter((p) => p.label.toLowerCase().includes(q)) : [];
  const actionMatches = q ? ACTIONS.filter((a) => a.label.toLowerCase().includes(q)) : [];
  const propertyMatches = q.length >= 2
    ? properties.filter((p) => p.name.toLowerCase().includes(q) || (p.location ?? "").toLowerCase().includes(q)).slice(0, 6)
    : [];
  const hasAnyResults = pageMatches.length > 0 || actionMatches.length > 0 || propertyMatches.length > 0
    || tenantResults.length > 0 || unitResults.length > 0 || maintenanceResults.length > 0
    || complianceResults.length > 0 || vendorResults.length > 0 || communicationResults.length > 0;
  const showDropdown = open && q.length > 0;

  const clear = () => {
    setQuery("");
    setTenantResults([]);
    setUnitResults([]);
    setMaintenanceResults([]);
    setComplianceResults([]);
    setVendorResults([]);
    setCommunicationResults([]);
  };

  const goToProperty = (propertyId: string, path: string) => {
    const prop = properties.find((p) => p.id === propertyId);
    if (prop) setSelectedProperty({ id: prop.id, name: prop.name, location: prop.location });
    navigate({ to: path });
    clear();
    setOpen(false);
    onNavigate?.();
  };

  const goToPage = (to: string) => {
    navigate({ to });
    clear();
    setOpen(false);
    onNavigate?.();
  };

  const runAction = (key: string) => {
    onAction?.(key);
    clear();
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search anything…"
          className="w-full rounded-xl border border-border bg-white pl-9 pr-8 py-2 text-sm outline-none focus:border-primary transition-colors"
        />
        {query && (
          <button onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-white shadow-lg z-50">
          {q.length < 2 && pageMatches.length === 0 && actionMatches.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground text-center">Keep typing to search everything — properties, tenants, units, maintenance, compliance, vendors, communications, settings…</div>
          )}

          {pageMatches.length > 0 && (
            <div className="p-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pages</div>
              {pageMatches.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.to}
                    onClick={() => goToPage(p.to)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" /> {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {actionMatches.length > 0 && (
            <div className="p-2 border-t border-border">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Settings</div>
              {actionMatches.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    onClick={() => runAction(a.key)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    style={a.key === "delete_account" ? { color: "#DC2626" } : undefined}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" style={a.key === "delete_account" ? { color: "#DC2626" } : undefined} /> {a.label}
                  </button>
                );
              })}
            </div>
          )}

          {q.length >= 2 && (
            <>
              {propertyMatches.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Properties</div>
                  {propertyMatches.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => goToProperty(p.id, "/dashboard")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{p.name}</span>
                        {p.location && <span className="block text-xs text-muted-foreground truncate">{p.location}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {tenantResults.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tenants</div>
                  {tenantResults.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => goToProperty(t.property_id, "/tenants")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{t.full_name}</span>
                        <span className="block text-xs text-muted-foreground truncate">Unit {t.unit} · {t.propertyName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {unitResults.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Units</div>
                  {unitResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => goToProperty(u.property_id, "/units")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <Grid3x3 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{u.unit_name}</span>
                        <span className="block text-xs text-muted-foreground truncate">{u.propertyName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {maintenanceResults.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Maintenance</div>
                  {maintenanceResults.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => goToProperty(m.property_id, "/maintenance")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <Wrench className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{m.title}</span>
                        <span className="block text-xs text-muted-foreground truncate capitalize">{m.status.replace("_", " ")} · {m.propertyName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {complianceResults.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Compliance</div>
                  {complianceResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => goToProperty(c.property_id, "/compliance")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <ShieldCheck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{c.type}</span>
                        <span className="block text-xs text-muted-foreground truncate">{c.propertyName}{c.document_number ? ` · ${c.document_number}` : ""}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {vendorResults.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Vendors</div>
                  {vendorResults.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => goToPage("/vendors")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <Hammer className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{v.name}</span>
                        {v.trade && <span className="block text-xs text-muted-foreground truncate">{v.trade}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {communicationResults.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Communications</div>
                  {communicationResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => goToProperty(c.property_id, "/communications")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground truncate">{c.tenant_name}</span>
                        <span className="block text-xs text-muted-foreground truncate">{c.type} · {c.propertyName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {!loading && !hasAnyResults && (
                <div className="p-4 text-sm text-muted-foreground text-center">No matches for "{query}".</div>
              )}
              {loading && <div className="p-4 text-xs text-muted-foreground text-center">Searching…</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}