/** Fixed set of unit types — a dropdown, not free text, so data stays
 * consistent across landlords (no "Studio" vs "studio" vs "1BR" drift). */
export const UNIT_TYPES = [
  { value: "bedsitter", label: "Bedsitter" },
  { value: "studio", label: "Studio" },
  { value: "1_bedroom", label: "1 Bedroom" },
  { value: "2_bedroom", label: "2 Bedroom" },
  { value: "3_bedroom", label: "3 Bedroom" },
  { value: "4_plus_bedroom", label: "4+ Bedroom" },
] as const;

export type UnitType = (typeof UNIT_TYPES)[number]["value"];

/** Human-readable label for a stored unit_type value. Returns null for
 * null/unrecognized input so callers can decide how to render "not set". */
export function unitTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return UNIT_TYPES.find((t) => t.value === value)?.label ?? null;
}
