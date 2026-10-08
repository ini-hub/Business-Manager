/**
 * Every customer-facing client route (wouter path in client/src/App.tsx). It
 * feeds the admin gate-rule picker, so a super admin can only attach a gate to a
 * screen that exists. client/src/App.routes.test.ts fails when this list and
 * App.tsx disagree, so it cannot drift.
 */
export const APP_SCREEN_PATHS: readonly string[] = [
  "/", "/customers", "/customers/new", "/customers/:id/edit", "/customers/:id/activity", "/customers/:id",
  "/staff", "/staff/attendance", "/staff/performance", "/staff/payroll", "/staff/payroll/:periodId", "/staff/hr-profile",
  "/staffs", "/staffs/new", "/staffs/:id/edit", "/staffs/:id/activity", "/staffs/:id/hr-profile", "/staffs/attendance", "/staffs/performance", "/staffs/:id",
  "/inventory", "/inventory/new", "/inventory/audits/new", "/inventory/:id/edit", "/inventory/:id/restock", "/inventory/:id",
  "/sales/new", "/transactions", "/transactions/:id",
  "/profit-loss", "/expenses", "/expenses/new", "/expenses/categories", "/expenses/:id/edit", "/credit-sales",
  "/bookings/new", "/bookings/:id/edit", "/bookings/:id", "/bookings",
  "/broadcasts", "/reports", "/reports/service-profitability", "/reports/balance-sheet", "/reports/audit-logs",
  "/payroll", "/payroll/new", "/payroll/advances", "/payroll/report", "/payroll/:periodId/staff/:staffId",
  "/profile", "/help-support",
  "/settings", "/settings/stores", "/settings/roles", "/settings/hr-profiles", "/settings/business", "/settings/store-settings",
  "/settings/store-details", "/settings/attendance", "/settings/credit-sales", "/settings/payment-integrations",
  "/settings/whatsapp-number", "/settings/capital-assets", "/settings/bulk-operations", "/settings/stores/new",
  "/settings/stores/:id/edit", "/settings/business/new", "/settings/business/edit", "/settings/roles/new",
  "/settings/roles/:id/edit", "/settings/taxes", "/settings/promotions", "/settings/billing", "/settings/billing/payment-history",
  "/vendors", "/vendors/new", "/vendors/:id/edit", "/vendors/:vendorId/bills/new", "/vendors/bills/:billId/pay",
  "/quotes", "/leaderboard", "/purchase-orders", "/purchase-orders/new", "/purchase-orders/:id/edit", "/purchase-orders/:id", "/stock-transfers",
  "/analytics", "/analytics/dashboards", "/analytics/dashboards/:id",
  "/bookings/calendar", "/customers/insights", "/inventory/audits", "/payroll/:periodId", "/quotes/new", "/quotes/:id",
  "/staffs/performance/analytics", "/stock-transfers/new", "/transactions/register-shifts",
  "/partners", "/partners/transfers/new", "/partners/transfers/:id", "/partners/ledger",
];
