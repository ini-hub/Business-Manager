import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { staff, type Staff } from "./staff";
import { users } from "./auth";
import { creditEntries, repayments } from "./credit";

// ========== PAYROLL TABLES ==========

// Attendance status enum — 'leave' added to support paid/unpaid leave tracking
export const attendanceStatusEnum = ["present", "absent", "off_day", "holiday", "leave"] as const;
export type AttendanceStatus = typeof attendanceStatusEnum[number];

// Attendance records table - one record per staff per day
export const attendanceRecords = pgTable("attendance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  date: text("date").notNull(), // ISO date string YYYY-MM-DD
  status: text("status").notNull(), // present, absent, off_day, holiday
  notes: text("notes"),
  markedByUserId: varchar("marked_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("attendance_staff_date_unique").on(table.storeId, table.staffId, table.date),
  index("idx_attendance_staff_date").on(table.staffId, table.date),
]);

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  store: one(stores, {
    fields: [attendanceRecords.storeId],
    references: [stores.id],
  }),
  staff: one(staff, {
    fields: [attendanceRecords.staffId],
    references: [staff.id],
  }),
  markedByUser: one(users, {
    fields: [attendanceRecords.markedByUserId],
    references: [users.id],
  }),
}));

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  status: z.enum(attendanceStatusEnum),
  notes: z.string().optional(),
});
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

// Payroll period status
export const payrollPeriodStatusEnum = ["pending", "approved", "paid"] as const;
export type PayrollPeriodStatus = typeof payrollPeriodStatusEnum[number];

// Payroll period type
export const payrollPeriodTypeEnum = ["weekly", "biweekly", "monthly"] as const;
export type PayrollPeriodType = typeof payrollPeriodTypeEnum[number];

// Payroll periods table
export const payrollPeriods = pgTable("payroll_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  periodType: text("period_type").notNull().default("monthly"), // weekly, biweekly, monthly
  startDate: text("start_date").notNull(), // ISO date YYYY-MM-DD
  endDate: text("end_date").notNull(),   // ISO date YYYY-MM-DD
  status: text("status").notNull().default("pending"), // pending, approved, paid
  settingsSnapshot: jsonb("settings_snapshot"), // Snapshot of rates used at calculation time
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payrollPeriodsRelations = relations(payrollPeriods, ({ one, many }) => ({
  store: one(stores, {
    fields: [payrollPeriods.storeId],
    references: [stores.id],
  }),
  approvedByUser: one(users, {
    fields: [payrollPeriods.approvedByUserId],
    references: [users.id],
  }),
  entries: many(payrollEntries),
}));

export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({ id: true, createdAt: true, approvedAt: true, paidAt: true, settingsSnapshot: true }).extend({
  periodType: z.enum(payrollPeriodTypeEnum).default("monthly"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD"),
  status: z.enum(payrollPeriodStatusEnum).default("pending"),
});
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;

// Payroll entries table — Option 4 Hybrid pay model per staff per period
export const payrollEntries = pgTable("payroll_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  activeDays: integer("active_days").notNull().default(0),
  passiveDays: integer("passive_days").notNull().default(0),
  activeTransport: numeric("active_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  passiveTransport: numeric("passive_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalTransport: numeric("total_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  grossCommission: numeric("gross_commission", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  leaveDays: integer("leave_days").notNull().default(0),
  holidayDays: integer("holiday_days").notNull().default(0),
  offDays: integer("off_days").notNull().default(0),
  absentDays: integer("absent_days").notNull().default(0),
  leavePay: numeric("leave_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  holidayPay: numeric("holiday_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  offDayPay: numeric("off_day_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  calculationDetails: jsonb("calculation_details"),
  carryForwardAmount: numeric("carry_forward_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("payroll_entry_period_staff_unique").on(table.periodId, table.staffId),
]);

export const payrollEntriesRelations = relations(payrollEntries, ({ one }) => ({
  period: one(payrollPeriods, {
    fields: [payrollEntries.periodId],
    references: [payrollPeriods.id],
  }),
  store: one(stores, {
    fields: [payrollEntries.storeId],
    references: [stores.id],
  }),
  staff: one(staff, {
    fields: [payrollEntries.staffId],
    references: [staff.id],
  }),
}));

export const insertPayrollEntrySchema = createInsertSchema(payrollEntries).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  activeTransport: z.number().optional(),
  passiveTransport: z.number().optional(),
  totalTransport: z.number().optional(),
  grossCommission: z.number().optional(),
  netPay: z.number().optional(),
  leavePay: z.number().optional(),
  holidayPay: z.number().optional(),
  offDayPay: z.number().optional(),
});
export type InsertPayrollEntry = z.infer<typeof insertPayrollEntrySchema>;
export type PayrollEntry = typeof payrollEntries.$inferSelect;

// Extended payroll types for frontend
export type PayrollEntryWithStaff = PayrollEntry & {
  staff: Staff;
};

export type PayrollPeriodWithEntries = PayrollPeriod & {
  entries: PayrollEntryWithStaff[];
};

// Commission breakdown per checkout (computed, not stored)
export type CommissionBreakdown = {
  checkoutId: string;
  receiptNumber: string;
  transactionDate: string;
  inventoryName: string;
  inventoryType: string;
  serviceAmount: number;
  commissionPool: number;
  role: "lead" | "assistant_1" | "assistant_2";
  share: number;
  earned: number;
};

// Daily Summary Line for Option 4 drill-down
export type DailySummaryLine = {
  date: string;
  dayType: "Active" | "Passive" | "Absent";
  transport: number;
  servicesWorked: string;
  commissionEarned: number;
  dailyTotal: number;
};

// ── Payroll Deductions ──────────────────────────────────────────────────────
// Per-staff deductions applied against gross pay before disbursement
export const payrollDeductionTypeEnum = [
  "tax", "insurance", "penalty", "carry_forward", "advance_recovery", "staff_credit", "other",
] as const;
export type PayrollDeductionType = typeof payrollDeductionTypeEnum[number];

// Order in which deduction types claim a staff member's net pay when there
// isn't enough to cover everything. `staff_credit` is deliberately last so it
// absorbs the shortfall rather than crowding out statutory deductions — shop
// debt is the one line that can safely wait for the next period.
export const DEDUCTION_PRIORITY: readonly PayrollDeductionType[] = [
  "tax", "insurance", "penalty", "carry_forward", "advance_recovery", "other", "staff_credit",
];

export const payrollDeductions = pgTable("payroll_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  type: text("type").notNull(), // see payrollDeductionTypeEnum
  label: text("label").notNull(), // Human-readable description shown on payslip
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  // Set only for type = 'staff_credit': the Borrow Book debt this line recovers.
  creditEntryId: varchar("credit_entry_id").references(() => creditEntries.id),
  // The repayment written at mark-paid. Its presence is the idempotency guard
  // that stops a retried mark-paid from recovering the same debt twice.
  repaymentId: varchar("repayment_id").references(() => repayments.id),
  // A manager excluding a proposed line. Must be a flag, not a DELETE: payroll
  // is auto-recalculated on every sale, so a deleted proposal would reappear.
  isWaived: boolean("is_waived").notNull().default(false),
  waivedByUserId: varchar("waived_by_user_id").references(() => users.id),
  waivedAt: timestamp("waived_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_payroll_deductions_period_staff").on(table.periodId, table.staffId),
]);

export const payrollDeductionsRelations = relations(payrollDeductions, ({ one }) => ({
  period: one(payrollPeriods, { fields: [payrollDeductions.periodId], references: [payrollPeriods.id] }),
  staff: one(staff, { fields: [payrollDeductions.staffId], references: [staff.id] }),
  creditEntry: one(creditEntries, { fields: [payrollDeductions.creditEntryId], references: [creditEntries.id] }),
  repayment: one(repayments, { fields: [payrollDeductions.repaymentId], references: [repayments.id] }),
}));

export type PayrollDeduction = typeof payrollDeductions.$inferSelect;
export type InsertPayrollDeduction = typeof payrollDeductions.$inferInsert;

// ── Payroll Disbursements ───────────────────────────────────────────────────
// Tracks how each staff member was actually paid for a period
export const payrollDisbursements = pgTable("payroll_disbursements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).$type<number>().notNull(),
  method: text("method").notNull().default("cash"), // 'cash', 'bank_transfer', 'mobile_money'
  reference: text("reference"), // Bank reference or transaction ID
  notes: text("notes"),
  paidByUserId: varchar("paid_by_user_id").references(() => users.id),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
});

export const payrollDisbursementsRelations = relations(payrollDisbursements, ({ one }) => ({
  period: one(payrollPeriods, { fields: [payrollDisbursements.periodId], references: [payrollPeriods.id] }),
  staff: one(staff, { fields: [payrollDisbursements.staffId], references: [staff.id] }),
}));

export type PayrollDisbursement = typeof payrollDisbursements.$inferSelect;
export type InsertPayrollDisbursement = typeof payrollDisbursements.$inferInsert;

// ── Salary Advances ─────────────────────────────────────────────────────────
// Mid-period cash advances to staff, tracked for payroll deduction
export const salaryAdvanceStatusEnum = ["pending", "approved", "rejected"] as const;
export type SalaryAdvanceStatus = typeof salaryAdvanceStatusEnum[number];

export const salaryAdvances = pgTable("salary_advances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  notes: text("notes"),
  recoveredPeriodId: varchar("recovered_period_id").references(() => payrollPeriods.id), // Set when deducted from payroll
  isRecovered: boolean("is_recovered").notNull().default(false),
  givenByUserId: varchar("given_by_user_id").references(() => users.id), // the requester
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id), // distinct from givenByUserId
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salaryAdvancesRelations = relations(salaryAdvances, ({ one }) => ({
  store: one(stores, { fields: [salaryAdvances.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [salaryAdvances.staffId], references: [staff.id] }),
  recoveredPeriod: one(payrollPeriods, { fields: [salaryAdvances.recoveredPeriodId], references: [payrollPeriods.id] }),
}));

export type SalaryAdvance = typeof salaryAdvances.$inferSelect;
export type InsertSalaryAdvance = typeof salaryAdvances.$inferInsert;

// ── Payslip Records ───────────────────────────────────────────────────────────
// Immutable log of every payslip PDF that was generated. The UUID is embedded
// in the PDF as a QR code so the document can be verified against this record.
export const payslipRecords = pgTable("payslip_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  generatedByUserId: varchar("generated_by_user_id").references(() => users.id),
  grossPay: numeric("gross_pay", { precision: 12, scale: 2 }).$type<number>(),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).$type<number>(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const payslipRecordsRelations = relations(payslipRecords, ({ one }) => ({
  store: one(stores, { fields: [payslipRecords.storeId], references: [stores.id] }),
  period: one(payrollPeriods, { fields: [payslipRecords.periodId], references: [payrollPeriods.id] }),
  staff: one(staff, { fields: [payslipRecords.staffId], references: [staff.id] }),
}));

export type PayslipRecord = typeof payslipRecords.$inferSelect;
