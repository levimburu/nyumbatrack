import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  amountDueFor,
  canSendReminder,
  whatsappLink,
  type PaymentLike,
  type PaymentMethod,
  type ReminderInput,
} from "@/lib/reminders";

export interface PropertyPaymentDetails {
  payment_method: PaymentMethod | null;
  payment_number: string | null;
  payment_account: string | null;
}

/**
 * Fetch the selected property's payment columns once per page, then pass the
 * result down to each row's button. Called per-row this would fire N queries.
 */
export function usePropertyPaymentDetails(propertyId: string | undefined) {
  return useQuery({
    queryKey: ["property-payment-details", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("properties")
        .select("payment_method, payment_number, payment_account")
        .eq("id", propertyId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PropertyPaymentDetails | null;
    },
  });
}

interface TenantLike {
  full_name: string;
  phone: string | null;
  unit: string;
  rent_amount: number;
  next_due_date: string | null;
}

interface ReminderButtonProps {
  tenant: TenantLike;
  /** Every payment for this tenant. Used to work out what the due month still owes. */
  payments: PaymentLike[];
  property: PropertyPaymentDetails | null | undefined;
  landlordName?: string;
  /** "icon" for table rows and card footers, "button" for the payment panel. */
  variant?: "icon" | "button";
  className?: string;
}

function unitLabel(unit: string | null): string {
  const trimmed = (unit ?? "").trim();
  if (!trimmed) return "your unit";
  return /^unit\b/i.test(trimmed) ? trimmed : `Unit ${trimmed}`;
}

export function ReminderButton({
  tenant,
  payments,
  property,
  landlordName,
  variant = "icon",
  className = "",
}: ReminderButtonProps) {
  const input: ReminderInput = {
    tenantName: tenant.full_name ?? "",
    tenantPhone: tenant.phone ?? "",
    unitNumber: unitLabel(tenant.unit),
    rentAmount: Number(tenant.rent_amount ?? 0),
    nextDueDate: tenant.next_due_date,
    amountDue: amountDueFor(Number(tenant.rent_amount ?? 0), tenant.next_due_date, payments),
    paymentMethod: property?.payment_method ?? null,
    paymentNumber: property?.payment_number ?? null,
    paymentAccount: property?.payment_account ?? null,
    landlordName,
  };

  const check = canSendReminder(input);
  const href = check.ok ? whatsappLink(input) : null;

  const base =
    variant === "icon"
      ? "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
      : "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors";

  if (!href) {
    return (
      <button
        type="button"
        disabled
        title={check.reason}
        aria-label={check.reason}
        onClick={(e) => e.stopPropagation()}
        className={`${base} cursor-not-allowed text-muted-foreground opacity-50 ${className}`}
        style={variant === "button" ? { background: "#F5F5F0" } : undefined}
      >
        <MessageCircle className="h-4 w-4" />
        {variant === "button" && <span>Send reminder</span>}
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Send a rent reminder to ${input.tenantName}`}
      aria-label={`Send a rent reminder to ${input.tenantName}`}
      // Tenant cards and rows are themselves clickable; don't open the panel too.
      onClick={(e) => e.stopPropagation()}
      className={
        variant === "icon"
          ? `${base} text-muted-foreground hover:bg-muted hover:text-[#166534] ${className}`
          : `${base} text-white glow-primary ${className}`
      }
      style={variant === "button" ? { background: "#166534" } : undefined}
    >
      <MessageCircle className="h-4 w-4" />
      {variant === "button" && <span>Send reminder</span>}
    </a>
  );
}
