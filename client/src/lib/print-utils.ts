// A print job's page size lives in a single, page-wide @page rule — it can't
// be scoped to a selector, so a thermal receipt (80mm roll, zero margin) and
// a full document like a proforma invoice (A4, normal margins) can't both
// have their own @page rule sitting statically in index.css at the same
// time. Instead we write the rule that applies *this* print job into a
// dedicated <style> tag right before calling window.print().
const STYLE_ID = "dynamic-print-page-style";

export type PrintFormat = "receipt-80mm" | "a4-document";

const PAGE_RULES: Record<PrintFormat, string> = {
  "receipt-80mm": "@page { size: 80mm auto; margin: 0; }",
  "a4-document": "@page { size: A4; margin: 12mm; }",
};

/** Sets the active @page rule for the next print job, then opens the print dialog. */
export function printWithFormat(format: PrintFormat) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@media print { ${PAGE_RULES[format]} }`;
  window.print();
}
