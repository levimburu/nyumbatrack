import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Copy, MapPin, Phone, User, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/format";
import { unitTypeLabel } from "@/lib/unitTypes";
import { telHref } from "@/lib/contacts";

const db = supabase as any;

export interface VacancyForDetail {
  unit_name: string;
  rent_price: number;
  unit_type: string | null;
  property: { id: string; name: string; location: string | null; photo_url: string | null };
}

export function VacancyDetail({ vacancy, onClose, onCopy }: { vacancy: VacancyForDetail; onClose: () => void; onCopy: () => void }) {
  const pid = vacancy.property.id;
  const { data: caretakers } = useQuery({
    queryKey: ["vacancy-caretakers", pid],
    queryFn: async () => {
      const { data } = await db.from("caretakers").select("id, full_name, phone").eq("property_id", pid);
      return (data ?? []) as { id: string; full_name: string; phone: string }[];
    },
  });
  const { data: owners } = useQuery({
    queryKey: ["vacancy-owners", pid],
    queryFn: async () => {
      const { data } = await db.rpc("property_owner_summaries", { _property: pid });
      return (data ?? []) as { owner_id: string; full_name: string; phone: string | null }[];
    },
  });
  const type = unitTypeLabel(vacancy.unit_type);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative grid h-36 place-items-center overflow-hidden" style={{ background: "linear-gradient(135deg, var(--k-166534) 0%, var(--k-15803D) 100%)" }}>
          {vacancy.property.photo_url
            ? <img src={vacancy.property.photo_url} alt={vacancy.property.name} className="absolute inset-0 h-full w-full object-cover" />
            : <Building2 className="h-12 w-12 text-white opacity-20" />}
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full bg-black/40 p-1.5 text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <h2 className="font-display text-xl font-bold">{vacancy.property.name}</h2>
            {vacancy.property.location && (
              <div className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{vacancy.property.location}</div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg p-2.5" style={{ background: "var(--k-F5F5F0)" }}><div className="text-xs text-muted-foreground">Unit</div><div className="font-display text-sm font-bold">{vacancy.unit_name}</div></div>
            <div className="rounded-lg p-2.5" style={{ background: "var(--k-F5F5F0)" }}><div className="text-xs text-muted-foreground">Type</div><div className="font-display text-sm font-bold">{type ?? "Not set"}</div></div>
            <div className="rounded-lg p-2.5" style={{ background: "var(--k-F5F5F0)" }}><div className="text-xs text-muted-foreground">Rent / month</div><div className="font-display text-sm font-bold" style={{ color: "var(--kt-16A34A)" }}>{formatKES(Number(vacancy.rent_price))}</div></div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caretaker (to arrange a viewing)</div>
            {(caretakers ?? []).length === 0 && <div className="text-sm text-muted-foreground">No caretaker number recorded for this property.</div>}
            {(caretakers ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-2 text-sm"><User className="h-4 w-4 text-muted-foreground" />{c.full_name}</div>
                <a href={telHref(c.phone)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white" style={{ background: "var(--k-166534)" }}>
                  <Phone className="h-3.5 w-3.5" /> {c.phone}
                </a>
              </div>
            ))}
          </div>

          {(owners ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Landlord</div>
              {(owners ?? []).map((o) => (
                <div key={o.owner_id} className="flex items-center justify-between text-sm">
                  <span>{o.full_name}</span>
                  {o.phone && <a href={telHref(o.phone)} className="font-medium text-green-800">{o.phone}</a>}
                </div>
              ))}
            </div>
          )}

          <button onClick={onCopy} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:bg-muted">
            <Copy className="h-4 w-4" /> Copy details
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
