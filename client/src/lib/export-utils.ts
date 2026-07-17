import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: string; header: string }[],
  filename: string
) {
  if (data.length === 0) return;

  const headers = columns.map((col) => col.header);
  const rows = data.map((item) =>
    columns.map((col) => {
      const value = getNestedValue(item, col.key);
      return formatValueForCSV(value);
    })
  );

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  downloadFile(csvContent, `${filename}.csv`, "text/csv");
}

export function exportToPDF<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: string; header: string }[],
  title: string,
  filename: string,
  options?: { orientation?: "portrait" | "landscape" }
) {
  const doc = new jsPDF({ orientation: options?.orientation ?? "portrait" });

  doc.setFontSize(16);
  doc.text(title, 14, 15);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 22);

  const headers = columns.map((col) => col.header);
  const rows = data.map((item) =>
    columns.map((col) => {
      const value = getNestedValue(item, col.key);
      return formatValueForPDF(value);
    })
  );

  const isDense = columns.length > 10;

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 28,
    styles: {
      fontSize: isDense ? 7 : 8,
      cellPadding: isDense ? 1.5 : 2,
    },
    headStyles: {
      fillColor: [41, 128, 185],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
  });

  doc.save(`${filename}.pdf`);
}

export type ReportStatusTone = "success" | "warning" | "critical" | "neutral";

export interface ReportKpi {
  label: string;
  value: string;
  sub?: string;
  subTone?: ReportStatusTone;
}

export interface ReportColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  format?: (row: T) => string;
}

export interface ReportPdfOptions<T extends Record<string, unknown>> {
  filename: string;
  title: string;
  businessName: string;
  storeName: string;
  periodLabel?: string;
  generatedAt?: Date;
  kpis?: ReportKpi[];
  columns: ReportColumn<T>[];
  rows: T[];
  /**
   * Column key whose numeric value is summed for subtotal/grand-total rows. Doesn't need
   * to be the last column — trailing columns after it render as a blank filler cell on
   * summary rows. Omit entirely for a report with no sum (e.g. a staff directory) — with
   * `groupBy` still set, each group gets a label-only section-header row instead.
   */
  amountKey?: string;
  /** Formats a summed amount for subtotal/grand-total rows; defaults to locale number formatting. */
  formatAmount?: (value: number) => string;
  /** Noun used in subtotal/grand-total labels, e.g. "receipts" or "items". */
  unitLabel?: string;
  /** Consecutive rows sharing the same group key get a subtotal row after them. */
  groupBy?: (row: T) => string;
  /** Column key that displays a status tone (colored) for each data row. */
  statusKey?: string;
  getStatus?: (row: T) => { label: string; tone: ReportStatusTone } | null;
  /** Marks a row's amount as voided — rendered in critical color with a strikethrough. */
  isVoided?: (row: T) => boolean;
  /** Non-zero return value labels the amount "{amount} charged" and adds a "-{amount} refunded" line below it, colored by the row's status tone. */
  getRefundedAmount?: (row: T) => number;
  orientation?: "portrait" | "landscape";
}

const TONE_COLORS: Record<ReportStatusTone, [number, number, number]> = {
  success: [23, 130, 90],
  warning: [168, 106, 18],
  critical: [181, 58, 52],
  neutral: [91, 101, 119],
};
const ACCENT_DEEP: [number, number, number] = [10, 76, 143];
const ACCENT_TINT: [number, number, number] = [228, 237, 248];
const INK: [number, number, number] = [18, 24, 38];
const INK_MUTED: [number, number, number] = [91, 101, 119];
const INK_FAINT: [number, number, number] = [139, 147, 163];
const LINE_STRONG: [number, number, number] = [194, 202, 219];

// jsPDF's built-in fonts (Helvetica, Courier, ...) only cover WinAnsi/Latin-1, which is
// missing currency glyphs report amounts actually need — ₦ (Naira) and ₵ (Cedi) chief
// among them for this app. Noto Sans covers those, so we fetch it once (lazily, only when
// a report PDF is generated) and embed it instead of relying on the standard 14 fonts.
let notoSansPromise: Promise<{ regular: string; bold: string } | null> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

async function loadNotoSansFonts(): Promise<{ regular: string; bold: string } | null> {
  if (!notoSansPromise) {
    notoSansPromise = Promise.all([
      fetch("/fonts/NotoSans-Regular.ttf").then((r) => r.arrayBuffer()),
      fetch("/fonts/NotoSans-Bold.ttf").then((r) => r.arrayBuffer()),
    ])
      .then(([regular, bold]) => ({ regular: arrayBufferToBase64(regular), bold: arrayBufferToBase64(bold) }))
      .catch(() => null);
  }
  return notoSansPromise;
}

/** Shared jsPDF setup: page geometry + Noto Sans embedding (for ₦/₵ glyph support). */
async function setupReportDoc(orientation: "portrait" | "landscape") {
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;

  const notoSans = await loadNotoSansFonts();
  const bodyFont = notoSans ? "NotoSans" : "helvetica";
  if (notoSans) {
    doc.addFileToVFS("NotoSans-Regular.ttf", notoSans.regular);
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    doc.addFileToVFS("NotoSans-Bold.ttf", notoSans.bold);
    doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  }
  return { doc, pageWidth, marginX, bodyFont };
}

interface MastheadOptions {
  bodyFont: string;
  pageWidth: number;
  marginX: number;
  businessName: string;
  title: string;
  storeName: string;
  periodLabel?: string;
  generatedAt: Date;
}

/** Draws the branded header band; returns the y-cursor immediately below it. */
function drawMasthead(doc: jsPDF, opts: MastheadOptions): number {
  const { bodyFont, pageWidth, marginX, businessName, title, storeName, periodLabel, generatedAt } = opts;
  const mastheadHeight = 24;
  doc.setFillColor(...ACCENT_DEEP);
  doc.rect(0, 0, pageWidth, mastheadHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(bodyFont, "bold");
  doc.setFontSize(14);
  doc.text(businessName, marginX, 10);
  doc.setFont(bodyFont, "normal");
  doc.setFontSize(8);
  doc.setTextColor(207, 225, 247);
  doc.text(title.toUpperCase(), marginX, 16);

  doc.setFontSize(8);
  doc.setTextColor(219, 233, 250);
  const metaLines = [
    `Store: ${storeName}`,
    periodLabel ? `Period: ${periodLabel}` : null,
    `Generated: ${generatedAt.toLocaleDateString()} ${generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
  ].filter((l): l is string => !!l);
  metaLines.forEach((line, i) => {
    doc.text(line, pageWidth - marginX, 9 + i * 4.6, { align: "right" });
  });

  return mastheadHeight;
}

interface KpiStripOptions {
  bodyFont: string;
  pageWidth: number;
  marginX: number;
  cursorY: number;
}

/** Draws the KPI strip below the masthead; returns the updated y-cursor. */
function drawKpiStrip(doc: jsPDF, kpis: ReportKpi[], opts: KpiStripOptions): number {
  const { bodyFont, pageWidth, marginX } = opts;
  let cursorY = opts.cursorY;
  if (kpis.length === 0) return cursorY;

  const kpiHeight = 16;
  const kpiWidth = (pageWidth - marginX * 2) / kpis.length;
  kpis.forEach((kpi, i) => {
    const x = marginX + i * kpiWidth;
    if (i > 0) {
      doc.setDrawColor(...LINE_STRONG);
      doc.line(x, cursorY + 2, x, cursorY + kpiHeight - 2);
    }
    doc.setFont(bodyFont, "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...INK_FAINT);
    doc.text(kpi.label.toUpperCase(), x + 3, cursorY + 6);
    doc.setFont(bodyFont, "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.text(kpi.value, x + 3, cursorY + 12.5);
    if (kpi.sub) {
      doc.setFont(bodyFont, "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...(kpi.subTone ? TONE_COLORS[kpi.subTone] : INK_MUTED));
      doc.text(kpi.sub, x + 3, cursorY + kpiHeight - 1.5);
    }
  });
  doc.setDrawColor(...LINE_STRONG);
  doc.line(marginX, cursorY + kpiHeight, pageWidth - marginX, cursorY + kpiHeight);
  cursorY += kpiHeight;
  return cursorY;
}

const FOOTER_TOTAL_PAGES_EXP = "{total_pages_count_string}";

interface FooterOptions {
  bodyFont: string;
  pageWidth: number;
  marginX: number;
  businessName: string;
  storeName: string;
}

/** Builds an autoTable `didDrawPage` callback that paints the shared footer band. */
function makeFooterDrawer(doc: jsPDF, opts: FooterOptions) {
  const { bodyFont, pageWidth, marginX, businessName, storeName } = opts;
  return (data: { pageNumber: number }) => {
    const footerY = doc.internal.pageSize.getHeight() - 8;
    doc.setFont(bodyFont, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_FAINT);
    doc.text(`${businessName} — Confidential`, marginX, footerY);
    doc.text(storeName, pageWidth / 2, footerY, { align: "center" });
    doc.text(`Page ${data.pageNumber} of ${FOOTER_TOTAL_PAGES_EXP}`, pageWidth - marginX, footerY, { align: "right" });
  };
}

/** Resolves the `{total_pages_count_string}` placeholder written by `makeFooterDrawer`. */
function finalizeFooterPageCount(doc: jsPDF) {
  if (typeof (doc as unknown as { putTotalPages?: (exp: string) => void }).putTotalPages === "function") {
    (doc as unknown as { putTotalPages: (exp: string) => void }).putTotalPages(FOOTER_TOTAL_PAGES_EXP);
  }
}

interface GroupedTableOptions<T extends Record<string, unknown>> {
  columns: ReportColumn<T>[];
  rows: T[];
  amountKey?: string;
  formatAmount: (n: number) => string;
  unitLabel: string;
  groupBy?: (row: T) => string;
  statusKey?: string;
  getStatus?: (row: T) => { label: string; tone: ReportStatusTone } | null;
  isVoided?: (row: T) => boolean;
  getRefundedAmount?: (row: T) => number;
  bodyFont: string;
  marginX: number;
  startY: number;
  didDrawPage: (data: { pageNumber: number }) => void;
}

/**
 * Draws the row-per-record table with grouped subtotals, a grand total, and status/void/
 * refund coloring — the schedule renderer shared by `exportReportToPDF` (as the whole
 * document body) and `exportFinancialStatementToPDF` (as the supporting schedule appended
 * below the statement waterfall).
 */
function renderGroupedTable<T extends Record<string, unknown>>(doc: jsPDF, opts: GroupedTableOptions<T>) {
  const {
    columns, rows, amountKey,
    formatAmount, unitLabel, groupBy, statusKey, getStatus, isVoided, getRefundedAmount,
    bodyFont, marginX, startY, didDrawPage,
  } = opts;

  type RowMeta = { kind: "data" | "subtotal" | "grandtotal"; tone?: ReportStatusTone; voided?: boolean; hasRefundNote?: boolean };
  const body: (string | { content: string; colSpan: number })[][] = [];
  const rowMeta: RowMeta[] = [];
  const amountColIndex = amountKey ? columns.findIndex((c) => c.key === amountKey) : -1;
  const statusColIndex = statusKey ? columns.findIndex((c) => c.key === statusKey) : -1;
  const labelSpan = amountColIndex >= 0 ? amountColIndex : columns.length;

  const pushDataRow = (row: T) => {
    const voided = isVoided ? isVoided(row) : false;
    const refunded = !voided && getRefundedAmount ? getRefundedAmount(row) : 0;
    const cells = columns.map((col) => col.format ? col.format(row) : formatValueForPDF(getNestedValue(row, col.key)));
    if (refunded > 0 && amountColIndex >= 0) {
      cells[amountColIndex] = `${cells[amountColIndex]} charged\n-${formatAmount(refunded)} refunded`;
    }
    body.push(cells);
    const status = getStatus ? getStatus(row) : null;
    rowMeta.push({ kind: "data", tone: status?.tone, voided, hasRefundNote: refunded > 0 });
  };

  // With no amountKey, a summary row is a single label spanning every column (a section
  // header). With one, the label spans up to the amount column, the amount cell follows,
  // and anything after it (the amount column need not be last) becomes a blank filler cell.
  const pushSummaryRow = (kind: "subtotal" | "grandtotal", label: string, amount: number) => {
    if (amountColIndex >= 0) {
      const trailingSpan = columns.length - amountColIndex - 1;
      const cells: (string | { content: string; colSpan: number })[] = [
        { content: label, colSpan: labelSpan },
        formatAmount(amount),
      ];
      if (trailingSpan > 0) cells.push({ content: "", colSpan: trailingSpan });
      body.push(cells);
    } else {
      body.push([{ content: label, colSpan: labelSpan }]);
    }
    rowMeta.push({ kind });
  };

  const sumGroup = (group: T[]) => {
    const counted = isVoided ? group.filter((r) => !isVoided(r)) : group;
    const sum = amountKey ? counted.reduce((s, r) => s + (Number(getNestedValue(r, amountKey)) || 0), 0) : 0;
    return { counted, sum };
  };

  if (groupBy) {
    let i = 0;
    while (i < rows.length) {
      const key = groupBy(rows[i]);
      const group: T[] = [];
      while (i < rows.length && groupBy(rows[i]) === key) {
        group.push(rows[i]);
        i++;
      }
      group.forEach(pushDataRow);
      const { counted, sum } = sumGroup(group);
      pushSummaryRow("subtotal", `${key} · ${counted.length} ${unitLabel}`, sum);
    }
  } else {
    rows.forEach(pushDataRow);
  }

  // A final summary row is worth showing whenever there's an amount to total or groups to
  // recap — a fully flat report (no amountKey, no groupBy) has nothing useful to add here.
  if ((amountKey || groupBy) && rows.length > 0) {
    const { counted, sum } = sumGroup(rows);
    pushSummaryRow("grandtotal", `Total · ${counted.length} ${unitLabel}`, sum);
  }

  const isDense = columns.length > 10;

  const columnStyles: Record<number, { halign: "left" | "right"; font: string }> = {};
  columns.forEach((col, i) => {
    columnStyles[i] = { halign: col.align === "right" ? "right" : "left", font: bodyFont };
  });

  autoTable(doc, {
    head: [columns.map((c) => c.header)],
    body,
    startY,
    margin: { top: 16, left: marginX, right: marginX, bottom: 16 },
    styles: {
      font: bodyFont,
      fontSize: isDense ? 7 : 8,
      cellPadding: isDense ? 1.5 : 2,
      textColor: INK,
      lineColor: [219, 225, 234],
      lineWidth: 0.1,
    },
    headStyles: {
      font: bodyFont,
      fillColor: [255, 255, 255],
      textColor: INK_MUTED,
      fontStyle: "bold",
      fontSize: isDense ? 6.5 : 7,
      lineWidth: { top: 0, right: 0, bottom: 0.3, left: 0 },
      lineColor: LINE_STRONG,
    },
    alternateRowStyles: { fillColor: [246, 249, 252] },
    columnStyles,
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const meta = rowMeta[data.row.index];
      if (!meta) return;
      if (meta.kind === "subtotal") {
        data.cell.styles.fillColor = ACCENT_TINT;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = INK_MUTED;
      } else if (meta.kind === "grandtotal") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = INK;
        data.cell.styles.lineWidth = { top: 0.5, right: 0, bottom: 0, left: 0 };
        data.cell.styles.lineColor = INK;
      } else {
        if (statusColIndex >= 0 && data.column.index === statusColIndex && meta.tone) {
          data.cell.styles.textColor = TONE_COLORS[meta.tone];
          data.cell.styles.fontStyle = "bold";
        }
        if (meta.voided && data.column.index === amountColIndex) {
          data.cell.styles.textColor = TONE_COLORS.critical;
        }
        if (meta.hasRefundNote && data.column.index === amountColIndex && meta.tone) {
          data.cell.styles.textColor = TONE_COLORS[meta.tone];
        }
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      const meta = rowMeta[data.row.index];
      if (meta?.kind === "data" && meta.voided && data.column.index === amountColIndex) {
        const midY = data.cell.y + data.cell.height / 2;
        doc.setDrawColor(...TONE_COLORS.critical);
        doc.setLineWidth(0.35);
        doc.line(data.cell.x + 1, midY, data.cell.x + data.cell.width - 1, midY);
      }
    },
    didDrawPage,
  });
}

/**
 * Renders a branded report PDF — masthead, KPI strip, grouped subtotals, status
 * coloring and a paginated footer — on top of the same jsPDF/autoTable stack
 * `exportToPDF` uses. See export-redesign notes: this is the "after" renderer.
 */
export async function exportReportToPDF<T extends Record<string, unknown>>(opts: ReportPdfOptions<T>) {
  const {
    filename, title, businessName, storeName, periodLabel,
    generatedAt = new Date(), kpis = [], columns, rows, amountKey,
    formatAmount = (n: number) => n.toLocaleString(),
    unitLabel = "rows", groupBy, statusKey, getStatus, isVoided, getRefundedAmount,
    orientation = "portrait",
  } = opts;

  const { doc, pageWidth, marginX, bodyFont } = await setupReportDoc(orientation);

  // --- Masthead ---
  const mastheadHeight = drawMasthead(doc, { bodyFont, pageWidth, marginX, businessName, title, storeName, periodLabel, generatedAt });

  // --- KPI strip ---
  const cursorY = drawKpiStrip(doc, kpis, { bodyFont, pageWidth, marginX, cursorY: mastheadHeight });

  renderGroupedTable(doc, {
    columns, rows, amountKey, formatAmount, unitLabel, groupBy, statusKey, getStatus, isVoided, getRefundedAmount,
    bodyFont, marginX, startY: cursorY + 4,
    didDrawPage: makeFooterDrawer(doc, { bodyFont, pageWidth, marginX, businessName, storeName }),
  });

  finalizeFooterPageCount(doc);

  doc.save(`${filename}.pdf`);
}

export type StatementLineKind = "section" | "line" | "subtotal" | "total";

export interface StatementLine {
  kind: StatementLineKind;
  label: string;
  /** Omit for section headers and label-only sub-headings. Negative values render parenthesized. */
  amount?: number;
  /** Indentation level under a section (0 = flush with the section header). */
  indent?: 0 | 1 | 2;
}

export interface FinancialStatementSchedule<T extends Record<string, unknown>> {
  /** Printed above the table as a small caps heading, e.g. "Supporting Schedule — Item Detail". */
  heading: string;
  columns: ReportColumn<T>[];
  rows: T[];
  amountKey?: string;
  unitLabel?: string;
  groupBy?: (row: T) => string;
  statusKey?: string;
  getStatus?: (row: T) => { label: string; tone: ReportStatusTone } | null;
}

export interface FinancialStatementPdfOptions<T extends Record<string, unknown>> {
  filename: string;
  title: string;
  businessName: string;
  storeName: string;
  periodLabel?: string;
  generatedAt?: Date;
  formatAmount?: (value: number) => string;
  /** The waterfall itself — revenue down through operating profit. */
  lines: StatementLine[];
  /** The item-by-item breakdown, appended below the waterfall as a supporting schedule. */
  schedule: FinancialStatementSchedule<T>;
  orientation?: "portrait" | "landscape";
}

interface StatementLinesOptions {
  bodyFont: string;
  pageWidth: number;
  marginX: number;
  startY: number;
  formatAmount: (value: number) => string;
}

/** Draws the labeled waterfall (section headers, indented lines, subtotal/total rules). Returns the y-cursor below the last line. */
function drawStatementLines(doc: jsPDF, lines: StatementLine[], opts: StatementLinesOptions): number {
  const { bodyFont, pageWidth, marginX, formatAmount } = opts;
  const rightX = pageWidth - marginX;
  const rowHeight = 6;
  const indentUnit = 5;
  let y = opts.startY;

  lines.forEach((line, idx) => {
    if (line.kind === "section") {
      y += idx === 0 ? 2 : 5;
      doc.setFont(bodyFont, "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...INK_MUTED);
      doc.text(line.label.toUpperCase(), marginX, y);
      y += rowHeight - 1;
      return;
    }

    if (line.kind === "subtotal" || line.kind === "total") {
      doc.setDrawColor(...(line.kind === "total" ? INK : LINE_STRONG));
      doc.setLineWidth(line.kind === "total" ? 0.5 : 0.3);
      doc.line(marginX, y - 4, rightX, y - 4);
    }

    const indentX = marginX + (line.indent ?? 0) * indentUnit;
    const emphasized = line.kind === "total" || line.kind === "subtotal";
    doc.setFont(bodyFont, emphasized ? "bold" : "normal");
    doc.setFontSize(line.kind === "total" ? 9.5 : 8.5);
    doc.setTextColor(...INK);
    doc.text(line.label, indentX, y);

    if (line.amount !== undefined) {
      const negative = line.amount < 0;
      const amountText = negative ? `(${formatAmount(Math.abs(line.amount))})` : formatAmount(line.amount);
      doc.setTextColor(...(negative ? TONE_COLORS.critical : INK));
      doc.text(amountText, rightX, y, { align: "right" });
    }

    y += rowHeight;
  });

  return y;
}

/**
 * Renders the Profit & Loss export as an industry-standard Income Statement — a waterfall
 * of labeled, indented lines with subtotal/total rules — instead of a flat row-per-item
 * table. The supporting item-by-item breakdown is appended below via the same grouped-table
 * renderer `exportReportToPDF` uses, as backup detail rather than the headline document.
 */
export async function exportFinancialStatementToPDF<T extends Record<string, unknown>>(opts: FinancialStatementPdfOptions<T>) {
  const {
    filename, title, businessName, storeName, periodLabel,
    generatedAt = new Date(), formatAmount = (n: number) => n.toLocaleString(),
    lines, schedule, orientation = "portrait",
  } = opts;

  const { doc, pageWidth, marginX, bodyFont } = await setupReportDoc(orientation);

  const mastheadHeight = drawMasthead(doc, { bodyFont, pageWidth, marginX, businessName, title, storeName, periodLabel, generatedAt });

  let cursorY = drawStatementLines(doc, lines, { bodyFont, pageWidth, marginX, startY: mastheadHeight + 8, formatAmount });

  cursorY += 6;
  doc.setFont(bodyFont, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK_MUTED);
  doc.text(schedule.heading.toUpperCase(), marginX, cursorY);
  cursorY += 4;

  renderGroupedTable(doc, {
    columns: schedule.columns,
    rows: schedule.rows,
    amountKey: schedule.amountKey,
    formatAmount,
    unitLabel: schedule.unitLabel ?? "items",
    groupBy: schedule.groupBy,
    statusKey: schedule.statusKey,
    getStatus: schedule.getStatus,
    bodyFont, marginX, startY: cursorY + 2,
    didDrawPage: makeFooterDrawer(doc, { bodyFont, pageWidth, marginX, businessName, storeName }),
  });

  finalizeFooterPageCount(doc);

  doc.save(`${filename}.pdf`);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function formatValueForCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatValueForPDF(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
