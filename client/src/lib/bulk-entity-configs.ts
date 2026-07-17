export interface BulkEntityConfig {
  /** Used for data-testid suffixes and as the default query-invalidation key. */
  key: string;
  label: string;
  endpoint: string;
  exportFilename: string;
  sampleHeaders: string[];
  sampleRow: string[];
  sampleRows?: string[][];
  /** Query key prefixes to invalidate after a successful import. Defaults to [`/api/${key}`]. */
  invalidateQueryKeys?: string[];
}

export const CUSTOMER_BULK_CONFIG: BulkEntityConfig = {
  key: "customers",
  label: "Customers",
  endpoint: "/api/customers/bulk",
  exportFilename: "customers",
  sampleHeaders: ["name", "customerNumber", "mobileNumber", "address"],
  sampleRow: ["John Doe", "CUST-001", "555-1234", "123 Main Street"],
};

export const STAFF_BULK_CONFIG: BulkEntityConfig = {
  key: "staff",
  label: "Staff",
  endpoint: "/api/staff/bulk",
  exportFilename: "staff",
  sampleHeaders: ["name", "staffNumber", "mobileNumber", "payPerMonth", "signedContract"],
  sampleRow: ["Jane Smith", "STF-001", "555-5678", "3500", "true"],
};

export const INVENTORY_BULK_CONFIG: BulkEntityConfig = {
  key: "inventory",
  label: "Inventory",
  endpoint: "/api/inventory/bulk",
  exportFilename: "inventory",
  sampleHeaders: ["name", "type", "costPrice", "sellingPrice", "quantity", "variantOf", "variant_Size", "variant_Color", "variant_Duration"],
  sampleRows: [
    ["T-Shirt", "product", "5.00", "20.00", "0", "", "", "", ""],
    ["Small / Red", "product", "5.00", "20.00", "50", "T-Shirt", "S", "Red", ""],
    ["Large / Blue", "product", "5.00", "20.00", "30", "T-Shirt", "L", "Blue", ""],
    ["Relaxer", "product", "3000", "12000", "84", "", "", "", ""],
    ["Pedicure", "service", "500", "1500", "0", "", "", "", ""],
    ["Pedicure - Basic", "service", "500", "1500", "0", "Pedicure", "", "", "30min"],
    ["Pedicure - Premium", "service", "800", "2500", "0", "Pedicure", "", "", "60min"],
  ],
  sampleRow: ["T-Shirt", "product", "5.00", "20.00", "0", "", "", "", ""],
  invalidateQueryKeys: ["/api/products", "/api/inventory"],
};

export const EXPENSE_BULK_CONFIG: BulkEntityConfig = {
  key: "expenses",
  label: "Expenses",
  endpoint: "/api/expenses/bulk",
  exportFilename: "expenses",
  sampleHeaders: ["description", "amount", "category", "date", "notes"],
  sampleRow: ["Electricity Bill", "15000", "Utilities", "2026-07-01", "Monthly bill"],
};

export const VENDOR_BULK_CONFIG: BulkEntityConfig = {
  key: "vendors",
  label: "Vendors",
  endpoint: "/api/vendors/bulk",
  exportFilename: "vendors",
  sampleHeaders: ["name", "contactPerson", "phone", "email", "address", "category"],
  sampleRow: ["Acme Supplies", "John Acme", "555-1000", "sales@acme.com", "1 Industrial Way", "Supplier"],
};

export const PURCHASE_ORDER_BULK_CONFIG: BulkEntityConfig = {
  key: "purchase-orders",
  label: "Purchase Orders",
  endpoint: "/api/purchase-orders/bulk",
  exportFilename: "purchase_orders",
  sampleHeaders: ["poRef", "vendorName", "expectedDate", "productName", "quantity", "unitCost"],
  sampleRows: [
    ["PO-1001", "Acme Supplies", "2026-08-01", "T-Shirt", "50", "5.00"],
    ["PO-1001", "Acme Supplies", "2026-08-01", "Relaxer", "20", "3000"],
    ["PO-1002", "Beta Traders", "2026-08-05", "Pedicure Kit", "10", "800"],
  ],
  sampleRow: ["PO-1001", "Acme Supplies", "2026-08-01", "T-Shirt", "50", "5.00"],
  invalidateQueryKeys: ["/api/purchase-orders"],
};

export const QUOTE_BULK_CONFIG: BulkEntityConfig = {
  key: "quotes",
  label: "Quotes",
  endpoint: "/api/quotes/bulk",
  exportFilename: "quotes",
  sampleHeaders: ["quoteRef", "customerName", "validUntil", "productName", "quantity", "unitPrice"],
  sampleRows: [
    ["Q-2001", "Jane Doe", "2026-08-15", "T-Shirt", "3", "20.00"],
    ["Q-2001", "Jane Doe", "2026-08-15", "Relaxer", "1", "12000"],
    ["Q-2002", "John Smith", "2026-08-20", "Pedicure - Premium", "1", "2500"],
  ],
  sampleRow: ["Q-2001", "Jane Doe", "2026-08-15", "T-Shirt", "3", "20.00"],
  invalidateQueryKeys: ["/api/quotes"],
};

export const STOCK_TRANSFER_BULK_CONFIG: BulkEntityConfig = {
  key: "stock-transfers",
  label: "Stock Transfers",
  endpoint: "/api/stock-transfers/bulk",
  exportFilename: "stock_transfers",
  sampleHeaders: ["transferRef", "fromStoreId", "toStoreId", "productName", "quantity", "notes"],
  sampleRows: [
    ["TR-3001", "store-a-id", "store-b-id", "T-Shirt", "10", "Restock branch B"],
    ["TR-3001", "store-a-id", "store-b-id", "Relaxer", "5", "Restock branch B"],
  ],
  sampleRow: ["TR-3001", "store-a-id", "store-b-id", "T-Shirt", "10", "Restock branch B"],
  invalidateQueryKeys: ["/api/stock-transfers"],
};

export const CREDIT_SALES_BULK_CONFIG: BulkEntityConfig = {
  key: "credit-sales",
  label: "Credit Sales",
  endpoint: "/api/credit/entries/bulk",
  exportFilename: "credit_sales",
  sampleHeaders: ["customerName", "amount", "dueDate", "notes"],
  sampleRow: ["Jane Doe", "5000", "2026-08-30", "Salon package, pay after payday"],
  invalidateQueryKeys: ["/api/credit"],
};

export const BOOKING_BULK_CONFIG: BulkEntityConfig = {
  key: "bookings",
  label: "Bookings",
  endpoint: "/api/bookings/bulk",
  exportFilename: "bookings",
  sampleHeaders: ["bookingRef", "customerName", "staffName", "date", "time", "serviceName", "price", "duration"],
  sampleRows: [
    ["BK-4001", "Jane Doe", "Amaka", "2026-08-10", "10:00", "Pedicure - Basic", "1500", "30"],
    ["", "John Smith", "Chidi", "2026-08-11", "14:00", "Relaxer", "12000", "60"],
  ],
  sampleRow: ["BK-4001", "Jane Doe", "Amaka", "2026-08-10", "10:00", "Pedicure - Basic", "1500", "30"],
  invalidateQueryKeys: ["/api/bookings"],
};

export const TAX_RATE_BULK_CONFIG: BulkEntityConfig = {
  key: "tax-rates",
  label: "Tax Rates",
  endpoint: "/api/tax-rates/bulk",
  exportFilename: "tax_rates",
  sampleHeaders: ["name", "rate", "isDefault"],
  sampleRow: ["VAT", "7.5", "true"],
  invalidateQueryKeys: ["/api/tax-rates"],
};
