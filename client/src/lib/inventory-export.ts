import type { Product, Inventory } from "@shared/schema";

export type ExportGranularity = "item" | "variant";
export type ExportScope = "all" | "current-view" | "selected";

export type ExportableProduct = Product & {
  variants?: Inventory[];
  storeName?: string;
};

export interface InventoryExportRow {
  storeName: string;
  name: string;
  variantLabel: string;
  sku: string;
  barcode: string;
  type: string;
  category: string;
  brand: string;
  costPrice: string;
  sellingPrice: string;
  marginValue: string;
  marginPercent: string;
  quantity: string;
  unit: string;
  reorderPoint: string;
  stockStatus: string;
  stockValueCost: string;
  stockValueRetail: string;
  /** Raw numeric stock value (cost basis), 0 for services — for report subtotal math, not display. */
  stockValueCostRaw: number;
  /** Raw numeric stock value (retail basis), 0 for services — for report subtotal math, not display. */
  stockValueRetailRaw: number;
  variantCount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: string | number;
}

export interface BuildExportRowsOptions {
  granularity: ExportGranularity;
  lowStockThreshold: number;
  formatCurrency: (value: number) => string;
  isMultiStoreView: boolean;
}

export interface ExportColumnDef {
  key: string;
  header: string;
  defaultChecked: boolean;
  variantOnly?: boolean;
  multiStoreOnly?: boolean;
}

export const INVENTORY_EXPORT_COLUMNS: ExportColumnDef[] = [
  { key: "storeName", header: "Store", defaultChecked: true, multiStoreOnly: true },
  { key: "name", header: "Item Name", defaultChecked: true },
  { key: "variantLabel", header: "Variant", defaultChecked: true, variantOnly: true },
  { key: "sku", header: "SKU", defaultChecked: true },
  { key: "barcode", header: "Barcode", defaultChecked: false },
  { key: "type", header: "Type", defaultChecked: true },
  { key: "category", header: "Category", defaultChecked: false },
  { key: "brand", header: "Brand", defaultChecked: false },
  { key: "costPrice", header: "Cost Price", defaultChecked: true },
  { key: "sellingPrice", header: "Selling Price", defaultChecked: true },
  { key: "marginValue", header: "Margin", defaultChecked: false },
  { key: "marginPercent", header: "Margin %", defaultChecked: false },
  { key: "quantity", header: "Stock Qty", defaultChecked: true },
  { key: "unit", header: "Unit", defaultChecked: false },
  { key: "reorderPoint", header: "Reorder Point", defaultChecked: false },
  { key: "stockStatus", header: "Stock Status", defaultChecked: true },
  { key: "stockValueCost", header: "Stock Value (Cost)", defaultChecked: false },
  { key: "stockValueRetail", header: "Stock Value (Retail)", defaultChecked: false },
  { key: "variantCount", header: "Variant Count", defaultChecked: false },
  { key: "status", header: "Status", defaultChecked: false },
  { key: "createdAt", header: "Created Date", defaultChecked: false },
  { key: "updatedAt", header: "Last Updated", defaultChecked: false },
];

export const DEFAULT_EXPORT_COLUMN_KEYS = new Set<string>(
  INVENTORY_EXPORT_COLUMNS.filter((c) => c.defaultChecked).map((c) => c.key)
);

export function resolveScopeProducts(
  scope: ExportScope,
  ctx: {
    activeProducts: ExportableProduct[];
    currentViewProducts: ExportableProduct[];
    selectedIds: (string | number)[];
  }
): ExportableProduct[] {
  switch (scope) {
    case "all":
      return ctx.activeProducts;
    case "current-view":
      return ctx.currentViewProducts;
    case "selected":
      return ctx.activeProducts.filter((p) => ctx.selectedIds.includes(p.id));
  }
}

export function buildExportColumnConfig(
  selectedKeys: Set<string>,
  granularity: ExportGranularity,
  isMultiStoreView: boolean
): { key: string; header: string }[] {
  return INVENTORY_EXPORT_COLUMNS.filter((col) => {
    if (!selectedKeys.has(col.key)) return false;
    if (col.multiStoreOnly && !isMultiStoreView) return false;
    if (col.variantOnly && granularity !== "variant") return false;
    return true;
  }).map((col) => ({ key: col.key, header: col.header }));
}

export function computeExportOrientation(columnCount: number): "portrait" | "landscape" {
  return columnCount > 6 ? "landscape" : "portrait";
}

function formatRange(min: number, max: number, formatter: (n: number) => string): string {
  return min === max ? formatter(min) : `${formatter(min)} - ${formatter(max)}`;
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function computeStockStatus(quantity: number, reorderPoint: number | null | undefined, lowStockThreshold: number): string {
  const threshold = reorderPoint != null ? reorderPoint : lowStockThreshold;
  if (quantity === 0) return "Out of Stock";
  if (quantity <= threshold) return "Low Stock";
  return "In Stock";
}

function buildVariantRow(
  product: ExportableProduct,
  variant: Inventory,
  status: string,
  options: BuildExportRowsOptions
): InventoryExportRow {
  const isService = product.type === "service";
  const marginVal = variant.sellingPrice - variant.costPrice;
  const marginPct = variant.sellingPrice > 0 ? (marginVal / variant.sellingPrice) * 100 : 0;
  const dims = (variant.variantDimensions as Record<string, unknown>) || {};
  const dimEntries = Object.entries(dims).filter(([, v]) => !!v);
  const variantLabel = dimEntries.length > 0 ? dimEntries.map(([k, v]) => `${k}: ${v}`).join(", ") : "—";

  return {
    storeName: options.isMultiStoreView ? product.storeName ?? "" : "",
    name: product.name,
    variantLabel,
    sku: variant.sku || "—",
    barcode: variant.barcode || "—",
    type: isService ? "Service" : "Product",
    category: product.category || "—",
    brand: product.brand || "—",
    costPrice: options.formatCurrency(variant.costPrice),
    sellingPrice: options.formatCurrency(variant.sellingPrice),
    marginValue: options.formatCurrency(marginVal),
    marginPercent: `${marginPct.toFixed(1)}%`,
    quantity: isService ? "N/A" : String(parseFloat(Number(variant.quantity).toFixed(4))),
    unit: variant.unit || "—",
    reorderPoint: variant.reorderPoint != null ? String(variant.reorderPoint) : "—",
    stockStatus: isService ? "Service" : computeStockStatus(variant.quantity, variant.reorderPoint, options.lowStockThreshold),
    stockValueCost: isService ? "—" : options.formatCurrency(variant.costPrice * variant.quantity),
    stockValueRetail: isService ? "—" : options.formatCurrency(variant.sellingPrice * variant.quantity),
    stockValueCostRaw: isService ? 0 : variant.costPrice * variant.quantity,
    stockValueRetailRaw: isService ? 0 : variant.sellingPrice * variant.quantity,
    variantCount: "",
    status,
    createdAt: formatDate(product.createdAt),
    updatedAt: formatDate(product.updatedAt),
  };
}

function buildItemRow(
  product: ExportableProduct,
  variants: Inventory[],
  status: string,
  options: BuildExportRowsOptions
): InventoryExportRow {
  const isService = product.type === "service";
  const storeName = options.isMultiStoreView ? product.storeName ?? "" : "";
  const createdAt = formatDate(product.createdAt);
  const updatedAt = formatDate(product.updatedAt);

  if (variants.length === 0) {
    return {
      storeName,
      name: product.name,
      variantLabel: "—",
      sku: "—",
      barcode: "—",
      type: isService ? "Service" : "Product",
      category: product.category || "—",
      brand: product.brand || "—",
      costPrice: "—",
      sellingPrice: "—",
      marginValue: "—",
      marginPercent: "—",
      quantity: isService ? "N/A" : "0",
      unit: "—",
      reorderPoint: "—",
      stockStatus: isService ? "Service" : "Out of Stock",
      stockValueCost: "—",
      stockValueRetail: "—",
      stockValueCostRaw: 0,
      stockValueRetailRaw: 0,
      variantCount: "0",
      status,
      createdAt,
      updatedAt,
    };
  }

  const costs = variants.map((v) => v.costPrice);
  const prices = variants.map((v) => v.sellingPrice);
  const margins = variants.map((v) => {
    const val = v.sellingPrice - v.costPrice;
    const pct = v.sellingPrice > 0 ? (val / v.sellingPrice) * 100 : 0;
    return { val, pct };
  });

  const totalQty = variants.reduce((sum, v) => sum + v.quantity, 0);
  const totalCostValue = variants.reduce((sum, v) => sum + v.costPrice * v.quantity, 0);
  const totalRetailValue = variants.reduce((sum, v) => sum + v.sellingPrice * v.quantity, 0);

  const units = Array.from(new Set(variants.map((v) => v.unit || "").filter(Boolean)));
  const unit = units.length === 0 ? "—" : units.length === 1 ? units[0] : "Mixed";

  const itemThreshold = variants[0]?.reorderPoint;
  const stockStatus = isService ? "Service" : computeStockStatus(totalQty, itemThreshold, options.lowStockThreshold);

  return {
    storeName,
    name: product.name,
    variantLabel: "—",
    sku: variants.length === 1 ? variants[0].sku || "—" : "—",
    barcode: variants.length === 1 ? variants[0].barcode || "—" : "—",
    type: isService ? "Service" : "Product",
    category: product.category || "—",
    brand: product.brand || "—",
    costPrice: formatRange(Math.min(...costs), Math.max(...costs), options.formatCurrency),
    sellingPrice: formatRange(Math.min(...prices), Math.max(...prices), options.formatCurrency),
    marginValue: formatRange(
      Math.min(...margins.map((m) => m.val)),
      Math.max(...margins.map((m) => m.val)),
      options.formatCurrency
    ),
    marginPercent: formatRange(
      Math.min(...margins.map((m) => m.pct)),
      Math.max(...margins.map((m) => m.pct)),
      (v) => `${v.toFixed(1)}%`
    ),
    quantity: isService ? "N/A" : String(parseFloat(Number(totalQty).toFixed(4))),
    unit,
    reorderPoint: variants.length === 1
      ? (variants[0].reorderPoint != null ? String(variants[0].reorderPoint) : "—")
      : "—",
    stockStatus,
    stockValueCost: isService ? "—" : options.formatCurrency(totalCostValue),
    stockValueRetail: isService ? "—" : options.formatCurrency(totalRetailValue),
    stockValueCostRaw: isService ? 0 : totalCostValue,
    stockValueRetailRaw: isService ? 0 : totalRetailValue,
    variantCount: String(variants.length),
    status,
    createdAt,
    updatedAt,
  };
}

export function buildInventoryExportRows(
  activeProducts: ExportableProduct[],
  archivedProducts: ExportableProduct[] | null,
  options: BuildExportRowsOptions
): InventoryExportRow[] {
  const groups: { product: ExportableProduct; status: string }[] = [
    ...activeProducts.map((product) => ({ product, status: "Active" })),
    ...(archivedProducts ?? []).map((product) => ({ product, status: "Archived" })),
  ];

  const rows: InventoryExportRow[] = [];
  for (const { product, status } of groups) {
    const variants = product.variants ?? [];
    if (options.granularity === "variant") {
      for (const variant of variants) {
        rows.push(buildVariantRow(product, variant, status, options));
      }
    } else {
      rows.push(buildItemRow(product, variants, status, options));
    }
  }
  return rows;
}
