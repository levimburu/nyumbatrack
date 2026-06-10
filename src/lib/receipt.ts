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
  const h = doc.internal.pageSize.getHeight();

  // Header bar — green
  doc.setFillColor(22, 101, 52);
  doc.rect(0, 0, w, 80, "F");

  // Logo area
  doc.setFillColor(245, 158, 11);
  doc.roundedRect(32, 18, 36, 36, 4, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("N", 45, 42);

  // Company name
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("NYUMBATRACK", 78, 34);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("NyumbaTrack Technologies Ltd", 78, 48);
  doc.setFontSize(9);
  doc.text("Official Rent Receipt", 78, 62);

  // Receipt no on right
  doc.setFontSize(8);
  doc.text(`Receipt No: ${d.receiptNo}`, w - 32, 34, { align: "right" });
  doc.text(`Issued: ${formatDate(new Date())}`, w - 32, 48, { align: "right" });

  // Divider line
  doc.setDrawColor(22, 101, 52);
  doc.setLineWidth(0.5);
  doc.line(32, 96, w - 32, 96);

  // Body
  doc.setTextColor(34, 40, 49);
  let y = 118;

  // Received from section
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 110, 110);
  doc.text("RECEIVED FROM", 32, y);
  doc.text("UNIT", w - 32, y, { align: "right" });

  y += 14;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(34, 40, 49);
  doc.text(d.tenantName, 32, y);
  doc.text(d.unit, w - 32, y, { align: "right" });

  y += 24;
  doc.setDrawColor(230, 230, 225);
  doc.setLineWidth(0.5);
  doc.line(32, y, w - 32, y);

  y += 20;
  const rows: [string, string][] = [
    ["Amount paid", formatKES(d.amount)],
    ["Payment date", formatDate(d.paidOn)],
    ["Month paid for", d.paymentMonth ?? "—"],
    ["Payment method", d.method === "mpesa" ? "M-Pesa" : d.method === "bank" ? "Bank Transfer" : "Cash"],
    ["Reference", d.reference || "—"],
  ];

  rows.forEach(([k, v]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text(k, 32, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(34, 40, 49);
    doc.text(v, w - 32, y, { align: "right" });
    y += 20;
  });

  // Total paid banner — green
  y += 10;
  doc.setFillColor(220, 252, 231);
  doc.roundedRect(32, y, w - 64, 52, 6, 6, "F");
  doc.setDrawColor(22, 101, 52);
  doc.setLineWidth(1);
  doc.roundedRect(32, y, w - 64, 52, 6, 6, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(22, 101, 52);
  doc.text("TOTAL PAID", 48, y + 20);

  doc.setFontSize(18);
  doc.setTextColor(22, 101, 52);
  doc.text(formatKES(d.amount), w - 48, y + 32, { align: "right" });

  // Footer
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(140, 140, 140);
  doc.text("This is an official system-generated receipt by NyumbaTrack Technologies Ltd.", 32, h - 32);
  doc.text("© 2026 NyumbaTrack Technologies Ltd. All rights reserved. Built for Kenyan landlords.", 32, h - 20);

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