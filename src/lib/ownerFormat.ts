export function ago(iso: string | null): string {
  if (!iso) return "Never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

export interface CompanyStat {
  id: string; name: string; kind: "company" | "individual"; status: "active" | "suspended"; created_at: string;
  plan: string | null; price_kes: number | null; paid_until: string | null; billing_notes: string | null;
  members: number; properties: number; units: number; tenants: number;
  last_active: string | null; officer_email: string | null;
}

export function isOverdue(c: CompanyStat): boolean {
  return c.kind === "company" && c.status === "active" && !!c.paid_until && new Date(c.paid_until) < new Date(new Date().toDateString());
}
