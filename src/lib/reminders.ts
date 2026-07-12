export type PaymentMethod =
  | "mpesa_paybill"
  | "mpesa_till"
  | "mpesa_phone"
  | "bank"
  | "cash";

export type RentStatus = "paid" | "partial" | "unpaid";

/** Matches the labels payments.tsx writes into payments.payment_month. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface PaymentLike {
  payment_month: string | null;
  amount: number | string;
}

export interface ReminderInput {
  tenantName: string;
  tenantPhone: string;
  /** Already prefixed, e.g. "Unit B4". */
  unitNumber: string;
  rentAmount: number;
  /** tenants.next_due_date, exactly as Supabase returns it: "YYYY-MM-DD". */
  nextDueDate: string | null;
  /** rent_amount minus what has been paid for the due month. */
  amountDue: number;
  paymentMethod: PaymentMethod | null;
  paymentNumber: string | null;
  /** Null means: use the tenant's unit as the paybill account. */
  paymentAccount: string | null;
  landlordName?: string;
}

/**
 * Converts a Kenyan number to the bare international form wa.me expects:
 * 12 digits, country code first, no plus sign, no spaces.
 * Returns null if the input can't be read as a Kenyan mobile number.
 */
export function normalizeKenyanPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 12 && digits.startsWith("254")) return digits; // 254712345678
  if (digits.length === 10 && digits.startsWith("0")) return `254${digits.slice(1)}`; // 0712345678
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`; // 712345678

  return null;
}

/**
 * Splits "YYYY-MM-DD" by hand rather than going through new Date().
 * A `date` column has no time and no zone; letting the Date constructor
 * treat it as UTC midnight shifts the day for anyone west of Greenwich.
 */
function parseDbDate(raw: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return null;

  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Today in the browser's own timezone, as "YYYY-MM-DD", for string comparison. */
function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function currentMonthLabel(): string {
  const now = new Date();
  return `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

export function isOverdue(nextDueDate: string | null): boolean {
  if (!nextDueDate) return false;
  return nextDueDate.slice(0, 10) < todayIso();
}

/**
 * The month a tenant currently owes for.
 *
 * advanceNextDueDate() in payments.tsx sets next_due_date to the month AFTER
 * the last fully-paid one, so next_due_date's own month is the outstanding one.
 * Returns a label in the same format as payments.payment_month, e.g. "August 2026".
 */
export function dueMonthLabel(nextDueDate: string | null): string | null {
  if (!nextDueDate) return null;
  const parsed = parseDbDate(nextDueDate);
  if (!parsed) return null;
  return `${MONTHS[parsed.m - 1]} ${parsed.y}`;
}

function paidForMonth(payments: PaymentLike[], label: string): number {
  return payments
    .filter((p) => p.payment_month === label)
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

/**
 * What the tenant still owes for the due month. Strict: no due date, no amount.
 *
 * Deliberately ignores tenants.balance — that column is set once on insert and
 * never updated, so it does not reflect anything paid since.
 */
export function amountDueFor(
  rentAmount: number,
  nextDueDate: string | null,
  payments: PaymentLike[],
): number {
  const label = dueMonthLabel(nextDueDate);
  if (!label) return 0;
  return Math.max(0, Number(rentAmount) - paidForMonth(payments, label));
}

/**
 * Single source of truth for the status pill and the amount owing, shared by
 * the tenants and payments pages so the two can never disagree.
 * Falls back to the current calendar month when no due date is set.
 */
export function outstandingForDueMonth(
  rentAmount: number | string | null,
  nextDueDate: string | null,
  payments: PaymentLike[],
): { label: string; due: number; status: RentStatus } {
  const label = dueMonthLabel(nextDueDate) ?? currentMonthLabel();
  const rent = Number(rentAmount ?? 0) || 0;
  const paid = paidForMonth(payments, label);
  const due = Math.max(0, rent - paid);

  const status: RentStatus =
    rent <= 0 || due <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

  return { label, due, status };
}

function ordinal(day: number): string {
  if (day > 3 && day < 21) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatDueDate(raw: string): string | null {
  const parsed = parseDbDate(raw);
  if (!parsed) return null;
  return `${ordinal(parsed.d)} ${MONTHS[parsed.m - 1]} ${parsed.y}`;
}

function formatAmount(n: number): string {
  return `KES ${Math.round(n).toLocaleString("en-US")}`;
}

function paymentLine(input: ReminderInput): string {
  const { paymentMethod, paymentNumber, paymentAccount, unitNumber } = input;

  switch (paymentMethod) {
    case "mpesa_paybill": {
      const account = paymentAccount?.trim() || unitNumber.replace(/^unit\s+/i, "");
      return `Payment: M-Pesa Paybill ${paymentNumber}, account number ${account}`;
    }
    case "mpesa_till":
      return `Payment: M-Pesa Buy Goods, Till ${paymentNumber}`;
    case "mpesa_phone":
      return `Payment: M-Pesa Send Money to ${paymentNumber}`;
    case "bank":
      return `Payment: Bank transfer to ${paymentNumber}`;
    case "cash":
      return `Payment: Cash`;
    default:
      return "";
  }
}

export interface ReminderCheck {
  ok: boolean;
  reason?: string;
}

/** Call before rendering the button, so a disabled state carries a real explanation. */
export function canSendReminder(input: ReminderInput): ReminderCheck {
  if (!input.paymentMethod) {
    return { ok: false, reason: "Add payment details to this property first" };
  }
  if (input.paymentMethod !== "cash" && !input.paymentNumber) {
    return { ok: false, reason: "This property has no payment number saved" };
  }
  if (!normalizeKenyanPhone(input.tenantPhone)) {
    return { ok: false, reason: "This tenant has no valid phone number" };
  }
  if (!input.nextDueDate || !parseDbDate(input.nextDueDate)) {
    return { ok: false, reason: "This tenant has no due date set" };
  }
  if (input.amountDue <= 0) {
    const label = dueMonthLabel(input.nextDueDate);
    return { ok: false, reason: `Nothing outstanding for ${label ?? "this month"}` };
  }
  return { ok: true };
}

export function buildRentReminder(input: ReminderInput): string {
  const check = canSendReminder(input);
  if (!check.ok) throw new Error(check.reason ?? "Cannot build reminder");

  const dueIso = (input.nextDueDate as string).slice(0, 10);
  const dueText = formatDueDate(dueIso) as string;
  const overdue = isOverdue(dueIso);

  const firstName = input.tenantName.trim().split(" ")[0] || "there";

  // Owing less than a full month means they part-paid. Ask for the remainder.
  const partial = input.amountDue < Number(input.rentAmount);

  const lines = [
    `Hi ${firstName},`,
    ``,
    overdue
      ? `A reminder that rent for ${input.unitNumber} was due on ${dueText} and is still outstanding.`
      : `A reminder that rent for ${input.unitNumber} is due on ${dueText}.`,
    ``,
    partial
      ? `Amount due: ${formatAmount(input.amountDue)} (balance of ${formatAmount(input.rentAmount)} monthly rent)`
      : `Amount due: ${formatAmount(input.amountDue)}`,
    paymentLine(input),
    ``,
    overdue
      ? `Kindly settle this at your earliest convenience. Thank you.`
      : `Kindly pay by the due date. Thank you.`,
  ];

  if (input.landlordName?.trim()) {
    lines.push(``, input.landlordName.trim());
  }

  return lines.join("\n");
}

/**
 * Returns a wa.me URL, or null if the reminder can't be built.
 * Render this as an <a href> — window.open() after an await gets blocked as a popup.
 */
export function whatsappLink(input: ReminderInput): string | null {
  if (!canSendReminder(input).ok) return null;

  const phone = normalizeKenyanPhone(input.tenantPhone) as string;
  return `https://wa.me/${phone}?text=${encodeURIComponent(buildRentReminder(input))}`;
}