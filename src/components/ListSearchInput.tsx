import { Search, X } from "lucide-react";

// Shared filter-as-you-type search bar used at the top of list pages
// (Communications, Vendors, Arrears, Compliance, Maintenance). Purely a
// client-side filter over whatever's already loaded — separate from
// GlobalSearch, which jumps across the whole account instead of narrowing
// the current page's own list.
export function ListSearchInput({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border px-4 py-2.5 pl-10 pr-9 text-sm outline-none"
        style={{ borderColor: "var(--k-E5E7EB)", color: "var(--kt-111827)" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--k-166534)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--k-E5E7EB)")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
