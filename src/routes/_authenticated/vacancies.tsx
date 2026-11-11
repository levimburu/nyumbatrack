import { createFileRoute } from "@tanstack/react-router";
import { fetchManagedProperties, fetchManagedPropertyIds } from "@/lib/managedProperties";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { UNIT_TYPES, unitTypeLabel } from "@/lib/unitTypes";
import { Search, MapPin, Building2, Copy, DoorOpen, X } from "lucide-react";
import { toast } from "sonner";
import { VacancyDetail } from "@/components/VacancyDetail";

export const Route = createFileRoute("/_authenticated/vacancies")({
  component: VacanciesPage,
});

const ID_CHUNK = 100;
const PAGE_SIZE = 1000;
const SHOW_STEP = 60;
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Reads every row of a query, a page at a time, past the API's 1000-row cap. */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

interface PropertyRow {
  id: string;
  name: string;
  location: string | null;
  photo_url: string | null;
}
interface UnitRow {
  id: string;
  property_id: string;
  unit_name: string;
  rent_price: number;
  unit_type: string | null;
}
interface TenantUnit {
  property_id: string;
  unit: string;
}
interface Vacancy extends UnitRow {
  property: PropertyRow;
}

const NOT_SET = "not_set";

function VacanciesPage() {
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [minRent, setMinRent] = useState("");
  const [maxRent, setMaxRent] = useState("");
  const [visible, setVisible] = useState(SHOW_STEP);
  const [openVacancy, setOpenVacancy] = useState<Vacancy | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await (supabase as any).from("profiles").select("role").eq("id", user.id).maybeSingle();
      setIsAgent(data?.role === "agent");
    });
  }, []);

  // Same "properties I can manage" rule as Collections/Financials: an agent
  // sees every property of their linked landlords, a landlord sees their own.
  const { data: properties, isLoading: loadingProps } = useQuery({
    queryKey: ["vacancies-properties", isAgent],
    enabled: isAgent !== null,
    queryFn: async () => {
      return (await fetchManagedProperties("id, name, location, photo_url")) as PropertyRow[];
    },
  });

  const propertyIds = (properties ?? []).map((p) => p.id);

  const { data: units, isLoading: loadingUnits, error: unitsError } = useQuery({
    queryKey: ["vacancies-units", propertyIds.length, propertyIds[0] ?? ""],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const rows: UnitRow[] = [];
      for (const ids of chunk(propertyIds, ID_CHUNK)) {
        rows.push(...(await fetchAllPages<UnitRow>((from, to) =>
          (supabase as any).from("units").select("id, property_id, unit_name, rent_price, unit_type")
            .in("property_id", ids).order("id").range(from, to))));
      }
      return rows;
    },
  });

  const { data: tenantUnits, isLoading: loadingTenants, error: tenantsError } = useQuery({
    queryKey: ["vacancies-tenants", propertyIds.length, propertyIds[0] ?? ""],
    enabled: propertyIds.length > 0,
    queryFn: async () => {
      const rows: TenantUnit[] = [];
      for (const ids of chunk(propertyIds.length ? propertyIds : [PLACEHOLDER_ID], ID_CHUNK)) {
        rows.push(...(await fetchAllPages<TenantUnit>((from, to) =>
          (supabase as any).from("tenants").select("property_id, unit")
            .in("property_id", ids).order("id").range(from, to))));
      }
      return rows;
    },
  });

  // A unit is vacant purely by having no tenant in it — there is no
  // separate "vacant" flag, so moving a tenant in or out updates this list.
  const vacancies = useMemo<Vacancy[]>(() => {
    if (!properties || !units || !tenantUnits) return [];
    const byProperty = new Map(properties.map((p) => [p.id, p]));
    const occupied = new Set(tenantUnits.map((t) => `${t.property_id}|${t.unit}`));
    const out: Vacancy[] = [];
    for (const u of units) {
      const property = byProperty.get(u.property_id);
      if (!property || occupied.has(`${u.property_id}|${u.unit_name}`)) continue;
      out.push({ ...u, property });
    }
    return out;
  }, [properties, units, tenantUnits]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = minRent ? Number(minRent) : null;
    const max = maxRent ? Number(maxRent) : null;
    return vacancies
      .filter((v) => {
        if (typeFilter === NOT_SET ? !!v.unit_type : typeFilter !== "all" && v.unit_type !== typeFilter) return false;
        const rent = Number(v.rent_price);
        if (min !== null && !isNaN(min) && rent < min) return false;
        if (max !== null && !isNaN(max) && rent > max) return false;
        if (!q) return true;
        const hay = `${v.property.location ?? ""} ${v.property.name} ${v.unit_name} ${unitTypeLabel(v.unit_type) ?? ""}`.toLowerCase();
        return q.split(/\s+/).every((word) => hay.includes(word));
      })
      .sort((a, b) => Number(a.rent_price) - Number(b.rent_price));
  }, [vacancies, search, typeFilter, minRent, maxRent]);

  // Back to the first page of results whenever the filters change.
  useEffect(() => { setVisible(SHOW_STEP); }, [search, typeFilter, minRent, maxRent]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    vacancies.forEach((v) => {
      const k = v.unit_type ?? NOT_SET;
      counts[k] = (counts[k] ?? 0) + 1;
    });
    return counts;
  }, [vacancies]);

  const copyDetails = async (v: Vacancy) => {
    const type = unitTypeLabel(v.unit_type);
    const text =
      `${type ? `${type} ` : "Unit "}${type ? "available" : v.unit_name + " available"} at ${v.property.name}` +
      `${v.property.location ? `, ${v.property.location}` : ""}.\n` +
      `Unit: ${v.unit_name}\nRent: ${formatKES(Number(v.rent_price))} per month`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Details copied");
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  };

  const loading = isAgent === null || loadingProps || (propertyIds.length > 0 && (loadingUnits || loadingTenants));
  const error = unitsError || tenantsError;
  const hasFilters = !!search || typeFilter !== "all" || !!minRent || !!maxRent;

  const chip = (value: string, label: string, count?: number) => {
    const active = typeFilter === value;
    return (
      <button
        key={value}
        onClick={() => setTypeFilter(value)}
        className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
        style={active
          ? { background: "#166534", color: "#fff" }
          : { background: "#F0F0EB", color: "#374151" }}
      >
        {label}{count !== undefined ? ` · ${count}` : ""}
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Vacancies</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {loading ? "Loading…" : `${vacancies.length} vacant ${vacancies.length === 1 ? "unit" : "units"} across ${properties?.length ?? 0} ${properties?.length === 1 ? "property" : "properties"}`}
        </p>
      </div>

      <div className="card-surface p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="vacancy-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by area or property, e.g. Ruaka, Kilimani, Amani…"
            className="w-full rounded-xl border border-border bg-white py-2.5 pl-9 pr-9 text-sm outline-none focus:border-[#166534]"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {chip("all", "All", vacancies.length)}
          {UNIT_TYPES.map((t) => chip(t.value, t.label, typeCounts[t.value] ?? 0))}
          {(typeCounts[NOT_SET] ?? 0) > 0 && chip(NOT_SET, "Type not set", typeCounts[NOT_SET])}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Rent (KSh)</span>
          <input
            id="vacancy-min-rent" type="number" min={0} inputMode="numeric" value={minRent}
            onChange={(e) => setMinRent(e.target.value)} placeholder="Min"
            className="w-28 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-[#166534]"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            id="vacancy-max-rent" type="number" min={0} inputMode="numeric" value={maxRent}
            onChange={(e) => setMaxRent(e.target.value)} placeholder="Max"
            className="w-28 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-[#166534]"
          />
          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setTypeFilter("all"); setMinRent(""); setMaxRent(""); }}
              className="ml-auto text-xs font-medium" style={{ color: "#166534" }}
            >
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card-surface p-4 border-l-4" style={{ borderLeftColor: "#DC2626", background: "#FEF2F2" }}>
          <p className="text-sm font-semibold" style={{ color: "#991B1B" }}>Couldn't load vacancies</p>
          <p className="text-xs mt-1" style={{ color: "#991B1B" }}>{(error as any)?.message ?? String(error)}</p>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card-surface flex flex-col items-center px-4 py-12 text-center">
          <DoorOpen className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="font-medium text-foreground">
            {hasFilters ? "No vacant units match your search" : "No vacant units right now"}
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {hasFilters
              ? "Try a nearby area, a different unit type, or a wider rent range."
              : "Units appear here when they have no tenant."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {Math.min(visible, filtered.length)} of {filtered.length}, lowest rent first
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.slice(0, visible).map((v) => (
              <div key={v.id} role="button" tabIndex={0} onClick={() => setOpenVacancy(v)} onKeyDown={(e) => { if (e.key === "Enter") setOpenVacancy(v); }} className="card-surface overflow-hidden flex flex-col cursor-pointer transition-shadow hover:shadow-md">
                <div
                  className="relative h-28 grid place-items-center overflow-hidden"
                  style={{ background: "linear-gradient(135deg, #166534 0%, #15803d 100%)" }}
                >
                  {v.property.photo_url
                    ? <img src={v.property.photo_url} alt={v.property.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    : <Building2 className="h-10 w-10 opacity-20 text-white" />}
                  <div
                    className="absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{ background: "#F59E0B", color: "#fff" }}
                  >
                    {unitTypeLabel(v.unit_type) ?? "Type not set"}
                  </div>
                </div>
                <div className="p-4 flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-display font-bold text-foreground truncate">{v.property.name}</h3>
                      {v.property.location && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{v.property.location}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Unit</div>
                      <div className="font-display font-bold text-sm text-foreground">{v.unit_name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Rent per month</div>
                      <div className="font-display font-bold text-base" style={{ color: "#16A34A" }}>
                        {formatKES(Number(v.rent_price))}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyDetails(v); }}
                    className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy details
                  </button>
                </div>
              </div>
            ))}
          </div>
          {visible < filtered.length && (
            <div className="flex justify-center">
              <button
                onClick={() => setVisible((n) => n + SHOW_STEP)}
                className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Show more
              </button>
            </div>
          )}
        </>
      )}
      {openVacancy && <VacancyDetail vacancy={openVacancy} onClose={() => setOpenVacancy(null)} onCopy={() => copyDetails(openVacancy)} />}
    </div>
  );
}
