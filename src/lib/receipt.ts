import { jsPDF } from "jspdf";
import { formatKES, formatDate } from "./format";

export interface ReceiptData {
  tenantName: string;
  unit: string;
  amount: number;
  paidOn: string;
  method: string;
  reference?: string | null;
  receiptNo: string;
  paymentMonth?: string | null;
}

export function generateReceiptDoc(d: ReceiptData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a5" });
  const w = doc.internal.pageSize.getWidth();

  // Header bar
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, w, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("NYUMBATRACK", 32, 36);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Official Rent Receipt", 32, 54);

  // Receipt no on right
  doc.setFontSize(9);
  doc.text(`Receipt No: ${d.receiptNo}`, w - 32, 36, { align: "right" });
  doc.text(`Issued: ${formatDate(new Date())}`, w - 32, 50, { align: "right" });

  // Body
  doc.setTextColor(34, 40, 49);
  let y = 110;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Received from", 32, y);
  doc.setFont("helvetica", "normal");
  doc.text(d.tenantName, 32, y + 16);

  doc.setFont("helvetica", "bold");
  doc.text("Unit", w - 32, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(d.unit, w - 32, y + 16, { align: "right" });

  y += 56;
  doc.setDrawColor(220, 220, 215);
  doc.line(32, y, w - 32, y);

  y += 28;
  const rows: [string, string][] = [
    ["Amount paid", formatKES(d.amount)],
    ["Payment date", formatDate(d.paidOn)],
    ["Month paid for", d.paymentMonth ?? "—"],
    ["Payment method", d.method.toUpperCase()],
    ["Reference", d.reference || "—"],
  ];
  rows.forEach(([k, v]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text(k, 32, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(34, 40, 49);
    doc.text(v, w - 32, y, { align: "right" });
    y += 22;
  });

  // Amount banner
  y += 14;
  doc.setFillColor(219, 234, 254);
  doc.roundedRect(32, y, w - 64, 56, 6, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 64, 175);
  doc.text("TOTAL PAID", 48, y + 22);
  doc.setFontSize(20);
  doc.setTextColor(30, 64, 175);
  doc.text(formatKES(d.amount), w - 48, y + 34, { align: "right" });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("This is a NyumbaTrack system-generated receipt.", 32, doc.internal.pageSize.getHeight() - 28);
  doc.text("Thank you for your payment.", 32, doc.internal.pageSize.getHeight() - 16);

  return doc;
}

export function downloadReceipt(d: ReceiptData) {
  const doc = generateReceiptDoc(d);
  doc.save(`receipt-${d.receiptNo}.pdf`);
}

export function getReceiptDataUrl(d: ReceiptData): string {
  const doc = generateReceiptDoc(d);
  return doc.output("datauristring");
}