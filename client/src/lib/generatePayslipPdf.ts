import { format, parseISO } from "date-fns";
import { formatCurrency as fmt } from "@/lib/currency-utils";
import type { CommissionExplanation } from "@shared/commission-explainer";
import { commissionHeadline, needsExplanation } from "@shared/commission-explainer";
import type { PayrollEntryWithStaff, PayrollPeriod } from "@shared/schema";

export type PayslipDeduction = { id: string; label: string; amount: number | string; isWaived?: boolean };

/**
 * The one payslip PDF builder — extracted from the admin drill-down so the
 * manager view and a staff member's own "My Payroll" view produce byte-
 * identical documents and register through the same endpoint. See
 * shared/payroll-take-home.ts for why `gross`/`net`/`shortfall` are computed
 * upstream rather than re-derived here.
 */
export async function generatePayslipPdf(params: {
  entry: PayrollEntryWithStaff & { calculationDetails?: any; grossCommission?: number; totalTransport?: number; leavePay?: number; holidayPay?: number; offDayPay?: number };
  period: PayrollPeriod;
  activeDeductions: PayslipDeduction[];
  grossPay: number;
  takeHomePay: number;
  shortfall: number;
  currency: string;
  bizName: string;
  storeName: string;
  commissionExplanation: CommissionExplanation;
  isPeriodOngoing: boolean;
}): Promise<void> {
  const {
    entry, period, activeDeductions, grossPay: gross, takeHomePay: net, shortfall,
    currency, bizName, storeName, commissionExplanation, isPeriodOngoing,
  } = params;

  const fmtCur = (v: number) => fmt(v, currency);
  const commissionNote = commissionHeadline(commissionExplanation, fmtCur);

  const { jsPDF } = await import("jspdf");
  const QRCode = (await import("qrcode")).default;
  const doc = new jsPDF({ unit: "mm", format: "a5" });

  // ₦ (U+20A6) is outside Latin-1 — jsPDF built-in fonts silently degrade it
  const pdfFmt = (v: number) => fmtCur(v).replace(/₦/g, "NGN ");

  // Layout
  const W = 148;
  const L = 14;
  const R = 134;
  const C = (L + R) / 2;

  // Palette
  const NAVY:  [number,number,number] = [26,  35,  79];
  const WHITE: [number,number,number] = [255, 255, 255];
  const STRIPE:[number,number,number] = [245, 246, 250];
  const LABEL: [number,number,number] = [110, 115, 135];
  const BODY:  [number,number,number] = [35,  40,  58];
  const GREEN: [number,number,number] = [21,  128, 61];
  const RED:   [number,number,number] = [180, 35,  35];

  const per = `${format(parseISO(period.startDate), "MMM d")} – ${format(parseISO(period.endDate), "MMM d, yyyy")}`;

  // Register with backend to get a verifiable document ID
  let docId: string | null = null;
  try {
    const res = await fetch("/api/payroll/payslips/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ storeId: period.storeId, periodId: period.id, staffId: entry.staffId, grossPay: gross, netPay: net }),
    });
    if (res.ok) {
      const record = await res.json();
      docId = record.id;
    }
  } catch { /* non-blocking — PDF still generates without a doc ID */ }

  // Pre-render QR code as a data URL (points to the public verify page)
  let qrDataUrl: string | null = null;
  if (docId) {
    try {
      const verifyUrl = `${window.location.origin}/verify/payslip/${docId}`;
      qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 80, margin: 1, color: { dark: "#1a2350", light: "#ffffff" } });
    } catch { /* skip QR on failure */ }
  }

  // ── Header band ───────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 32, "F");

  doc.setTextColor(...WHITE);
  doc.setFontSize(20); doc.setFont("helvetica", "bold");
  doc.text("PAYSLIP", L, 16);

  doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text(bizName, R, 10, { align: "right" });
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  if (storeName) doc.text(storeName, R, 17, { align: "right" });
  doc.setFontSize(7.5);
  doc.text(`Period: ${per}`, R, storeName ? 24 : 18, { align: "right" });

  // ── Staff info block ──────────────────────────────────────────────────────
  doc.setTextColor(...NAVY);
  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text(entry.staff?.name || "Staff", L, 44);

  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.setTextColor(...LABEL);
  doc.text(`Staff #: ${entry.staff?.staffNumber || "—"}`, L, 51);
  if (entry.staff?.role) {
    doc.text(entry.staff.role.toUpperCase(), R, 51, { align: "right" });
  }

  doc.setDrawColor(210, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(L, 55, R, 55);

  /**
   * The commission derivation, indented under the Gross Commission row.
   *
   * Silent when the figure needs no defending. Otherwise: the reason in
   * words, then the arithmetic that produced it — so a staff member holding
   * a slip that reads NGN 0.00 can see the transport offset that consumed it
   * rather than assuming the system lost their money.
   */
  const writeCommissionNote = (yStart: number): number => {
    if (!needsExplanation(commissionExplanation)) return yStart;

    let ny = yStart;
    doc.setFontSize(6.5); doc.setFont("helvetica", "italic");
    doc.setTextColor(...LABEL);
    for (const line of doc.splitTextToSize(commissionNote, R - L - 6) as string[]) {
      doc.text(line, L + 4, ny);
      ny += 3.6;
    }

    doc.setFont("helvetica", "normal");
    for (const step of commissionExplanation.steps) {
      const amount = step.format === "count" ? String(step.value) : pdfFmt(step.value);
      doc.text(step.label, L + 6, ny);
      doc.text(step.kind === "less" ? `- ${amount}` : amount, R - 2, ny, { align: "right" });
      ny += 3.6;
    }

    return ny + 2.5;
  };

  // ── Earnings ──────────────────────────────────────────────────────────────
  let y = 63;

  doc.setFontSize(7); doc.setFont("helvetica", "bold");
  doc.setTextColor(...LABEL);
  doc.text("EARNINGS", L, y);
  y += 5;

  // Only what actually went into `gross`. A fixed-salary staff member is paid
  // the base and nothing else, and a commission-only one gets no base — the
  // slip used to print all three lines regardless, so the earnings did not
  // add up to the total printed directly beneath them.
  const paymentMethod = entry.calculationDetails?.paymentMethod;
  const earningsRows: { label: string; value: number | null; note?: string }[] = [];

  if (paymentMethod !== "commission") {
    earningsRows.push({ label: "Base Salary", value: entry.calculationDetails?.baseSalary || 0 });
  }
  if (paymentMethod !== "fixed") {
    earningsRows.push({ label: "Transport Allowance", value: entry.totalTransport || 0 });
    earningsRows.push(
      commissionExplanation.code === "fixed_salary"
        ? { label: "Gross Commission", value: null, note: commissionNote }
        : { label: "Gross Commission", value: entry.grossCommission || 0 },
    );
    if ((entry.leavePay   || 0) > 0) earningsRows.push({ label: "Leave Pay",   value: entry.leavePay || 0 });
    if ((entry.holidayPay || 0) > 0) earningsRows.push({ label: "Holiday Pay", value: entry.holidayPay || 0 });
    if ((entry.offDayPay  || 0) > 0) earningsRows.push({ label: "Off-Day Pay", value: entry.offDayPay || 0 });
  }

  earningsRows.forEach((row, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(...STRIPE);
      doc.rect(L - 2, y - 4.5, R - L + 4, 7, "F");
    }
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
    doc.setTextColor(...BODY);
    doc.text(row.label, L + 2, y);
    doc.text(row.value === null ? "—" : pdfFmt(row.value), R - 2, y, { align: "right" });
    y += 7;

    // The reason the figure is what it is, indented beneath it. Without this
    // a correct "NGN 0.00" is indistinguishable from a broken one.
    if (row.label === "Gross Commission") {
      y = writeCommissionNote(y);
    }
  });

  // Gross pay subtotal row. `gross` is pre-deduction — the rows above sum to it.
  y += 1;
  doc.setFillColor(228, 231, 244);
  doc.rect(L - 2, y - 1, R - L + 4, 8, "F");
  doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.setTextColor(...NAVY);
  doc.text("Gross Pay (before deductions)", L + 2, y + 5);
  doc.text(pdfFmt(gross), R - 2, y + 5, { align: "right" });
  y += 13;

  // ── Deductions ────────────────────────────────────────────────────────────
  if (activeDeductions.length > 0) {
    doc.setFontSize(7); doc.setFont("helvetica", "bold");
    doc.setTextColor(...LABEL);
    doc.text("DEDUCTIONS", L, y);
    y += 5;

    activeDeductions.forEach((d, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(...STRIPE);
        doc.rect(L - 2, y - 4.5, R - L + 4, 7, "F");
      }
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
      doc.setTextColor(...BODY);
      doc.text(d.label, L + 2, y);
      doc.setTextColor(...RED);
      doc.text(`- ${pdfFmt(Number(d.amount))}`, R - 2, y, { align: "right" });
      y += 7;
    });
    y += 3;
  }

  // ── Net pay band ──────────────────────────────────────────────────────────
  // `net` is floored at zero — it is the amount actually handed over, never a
  // negative. Deductions the pay could not cover show as the shortfall below.
  const isDeficit = shortfall > 0;
  doc.setFillColor(...(isDeficit ? RED : GREEN));
  doc.rect(L - 2, y, R - L + 4, 11, "F");
  doc.setFontSize(11); doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text("NET PAY", L + 2, y + 7.5);
  doc.text(pdfFmt(net), R - 2, y + 7.5, { align: "right" });
  y += 14;

  if (isDeficit) {
    doc.setFontSize(7); doc.setFont("helvetica", "italic");
    doc.setTextColor(...RED);
    doc.text(`* ${pdfFmt(shortfall)} could not be recovered and carries forward to the next payroll period`, C, y, { align: "center" });
    y += 6;
  } else {
    y += 3;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  // Thin separator
  doc.setDrawColor(210, 213, 225);
  doc.setLineWidth(0.2);
  doc.line(L, y, R, y);
  y += 5;

  if (isPeriodOngoing) {
    doc.setFontSize(7); doc.setFont("helvetica", "normal");
    doc.setTextColor(200, 100, 0);
    doc.text("* Period not yet closed - figures may change", C, y, { align: "center" });
    y += 5;
  }

  // QR code + doc ID (left), generation date (right)
  const qrSize = 18;
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, "PNG", L, y - 1, qrSize, qrSize);
    doc.setFontSize(6); doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("ORIGINAL COPY", L + qrSize + 2, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...LABEL);
    doc.setFontSize(5.5);
    doc.text(`Doc ID: ${docId}`, L + qrSize + 2, y + 8);
    doc.text("Scan QR to verify authenticity", L + qrSize + 2, y + 12);
  }

  doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
  doc.setTextColor(...LABEL);
  doc.text(`Generated on ${format(new Date(), "MMM d, yyyy")}`, R, y + (qrDataUrl ? 4 : 0), { align: "right" });

  doc.save(`payslip-${entry.staff?.name || entry.staffId}-${period.startDate}.pdf`);
}
