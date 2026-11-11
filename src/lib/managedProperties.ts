import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

function chunk<T>(arr: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * The one shared "properties I can manage" rule.
 *  - Senior Officer: every property of their company
 *  - Property Manager: only properties assigned to them
 *  - Landlord: their own properties
 *  - Legacy agent links (agent_landlord) keep working
 */
export async function fetchManagedProperties(
  cols = "id, name, location, user_id",
  order?: { column: string; ascending?: boolean },
): Promise<any[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const select = cols.trim() === "*" || /\bid\b/.test(cols) ? cols : `id, ${cols}`;

  const byId = new Map<string, any>();
  const add = (rows: any[] | null) => (rows ?? []).forEach((r) => byId.set(r.id, r));

  // 1. own properties
  {
    const { data, error } = await db.from("properties").select(select).eq("user_id", user.id);
    if (error) throw error;
    add(data);
  }

  // 2. company membership
  const { data: memberships, error: mErr } = await db
    .from("company_members").select("company_id, role").eq("user_id", user.id);
  if (mErr) throw mErr;
  const officerCompanies = (memberships ?? []).filter((m: any) => m.role === "senior_officer").map((m: any) => m.company_id);
  if (officerCompanies.length) {
    const { data, error } = await db.from("properties").select(select).in("company_id", officerCompanies);
    if (error) throw error;
    add(data);
  }
  const { data: assigned, error: aErr } = await db
    .from("property_assignments").select("property_id").eq("user_id", user.id);
  if (aErr) throw aErr;
  for (const ids of chunk((assigned ?? []).map((a: any) => a.property_id))) {
    const { data, error } = await db.from("properties").select(select).in("id", ids);
    if (error) throw error;
    add(data);
  }

  // 3. legacy agent links
  const { data: links } = await db.from("agent_landlord").select("landlord_id").eq("agent_id", user.id);
  const landlordIds = (links ?? []).map((l: any) => l.landlord_id);
  if (landlordIds.length) {
    const { data, error } = await db.from("properties").select(select).in("user_id", landlordIds);
    if (error) throw error;
    add(data);
  }

  const rows = Array.from(byId.values());
  if (order) {
    const { column, ascending = true } = order;
    rows.sort((a, b) => {
      const x = a[column], y = b[column];
      const c = x == null ? (y == null ? 0 : -1) : y == null ? 1 : String(x).localeCompare(String(y));
      return ascending ? c : -c;
    });
  }
  return rows;
}

export async function fetchManagedPropertyIds(): Promise<string[]> {
  return (await fetchManagedProperties("id")).map((p) => p.id);
}
