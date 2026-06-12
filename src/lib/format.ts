export const formatKES = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(v);
};

export const formatDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
export const formatKESCompact = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `Ksh ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `Ksh ${(v / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(v);
};
