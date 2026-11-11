/** tel: link that works for local (07…) and international Kenyan numbers. */
export function telHref(phone: string): string {
  const raw = phone.trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("0")) return `tel:+254${digits.slice(1)}`;
  if (digits.startsWith("254")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

export const OWNERSHIP_TYPES: { value: string; label: string }[] = [
  { value: "sole", label: "Sole owner" },
  { value: "joint", label: "Joint owners" },
  { value: "company", label: "Company-owned" },
  { value: "trust", label: "Trust / estate" },
  { value: "other", label: "Other" },
];

export function ownershipLabel(value: string): string {
  return OWNERSHIP_TYPES.find((t) => t.value === value)?.label ?? value;
}
