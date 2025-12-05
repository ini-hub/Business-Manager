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
  filename: string
) {
  const doc = new jsPDF();

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

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 28,
    styles: {
      fontSize: 8,
      cellPadding: 2,
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
