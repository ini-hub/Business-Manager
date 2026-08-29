import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { users } from "./auth";
import { customers } from "./customers";
import { staff } from "./staff";

// ── Sale Drafts ──────────────────────────────────────────────────────────────
// Saved (but not yet committed) POS cart sessions. Nothing in here touches
// inventory, revenue, or any financial record — it is purely a snapshot of
// the in-progress cart so staff can return to it later.
export const saleDrafts = pgTable("sale_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  name: text("name"), // optional label shown in the drafts list
  cartData: jsonb("cart_data").notNull().$type<Array<{
    inventoryId: string;
    name: string;
    type: string;
    quantity: number;
    customPrice: number;
    totalPrice: number;
    leadStaffId: string | null;
    assistingStaff1Id: string | null;
    assistingStaff2Id: string | null;
    commissionSplit: string;
    unit?: string | null;
    allowFractional?: boolean;
  }>>(),
  customerId: varchar("customer_id").references(() => customers.id),
  staffId: varchar("staff_id").references(() => staff.id),
  paymentMethod: text("payment_method").default("cash"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).$type<number>().default(0),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).$type<number>().default(0),
  discountReason: text("discount_reason"),
  discountApprovedBy: text("discount_approved_by"),
  redeemPoints: boolean("redeem_points").notNull().default(false),
  redeemStoreCredit: boolean("redeem_store_credit").notNull().default(false),
  creditUpfrontPaid: numeric("credit_upfront_paid", { precision: 12, scale: 2 }).$type<number>().default(0),
  creditDueDate: text("credit_due_date"),
  splitPayments: jsonb("split_payments").$type<Array<{ method: string; amount: number }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SaleDraft = typeof saleDrafts.$inferSelect;
