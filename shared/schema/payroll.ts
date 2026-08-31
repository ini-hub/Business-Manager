import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, uniqueIndex, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { staff, type Staff } from "./staff";
import { users } from "./auth";
import { creditEntries, repayments } from "./credit";
import type { CommissionExplanation } from "../commission-explainer";

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
  // ── Derived from attendance_punches, written in the same request as the punch.
  // Keeping the projection here means PayrollService still reads one table with
  // one query and gains arrival times for free.
  firstClockInAt: timestamp("first_clock_in_at"),
  lastClockOutAt: timestamp("last_clock_out_at"),
  isLate: boolean("is_late").notNull().default(false),
  lateMinutes: integer("late_minutes"),
  // The opening time in force when the punch landed, snapshotted so changing the
  // branch's hours next month cannot silently rewrite last month's history.
  expectedStartTime: text("expected_start_time"),
  shiftAutoClosed: boolean("shift_auto_closed").notNull().default(false),
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

/**
 * What `GET /api/payroll/periods/:id/entries` actually returns.
 *
 * `netPay` on the stored row is a *pre-deduction* figure despite its name, so
 * the endpoint decorates every row with the take-home split (see
 * shared/payroll-take-home.ts). The screens lead with `takeHomePay` — the money
 * that is actually handed over — rather than each one subtracting deductions
 * its own way and getting the zero floor wrong.
 */
export type PayrollEntryWithPay = PayrollEntryWithStaff & {
  grossPay: number;
  deductionsTotal: number;
  takeHomePay: number;
  shortfall: number;
};

export type PayrollPeriodWithEntries = PayrollPeriod & {
  entries: PayrollEntryWithStaff[];
};

/**
 * One service line's contribution to a staff member's commission (computed, not stored).
 *
 * `revenueShare` is the staff member's slice of the service price — exactly the
 * quantity the engine accumulates into `serviceRevenueContribution`, which the
 * commission formula then runs on. It is deliberately NOT a commission amount:
 * these rows used to report `price × commissionSplitStaffShare × role share`, a
 * second commission model that no formula uses, so the drill-down's total
 * contradicted the stored `grossCommission` on the same screen.
 */
export type CommissionBreakdown = {
  checkoutId: string;
  receiptNumber: string;
  transactionDate: string;
  inventoryName: string;
  inventoryType: string;
  serviceAmount: number;
  role: "lead" | "assistant_1" | "assistant_2";
  share: number;
  revenueShare: number;
};

// Daily Summary Line for Option 4 drill-down
export type DailySummaryLine = {
  date: string;
  dayType: "Active" | "Passive" | "Absent";
  transport: number;
  servicesWorked: string;
  /** Sum of this day's `CommissionBreakdown.revenueShare`. Pre-formula, so it is not pay. */
  revenueShare: number;
  // Clock-in detail, so the drill-down can show why a late-arrival deduction exists.
  clockInAt: string | null;
  isLate: boolean;
  lateDeduction: number;
};

/**
 * How the period's service lines add up to the commission that was actually
 * stored on the entry.
 *
 * Read from `payroll_entries`, never recomputed, so the drill-down is a view of
 * the paid figure rather than a rival calculation of it. `null` when the period
 * has never been calculated — the UI says so instead of inventing a total.
 */
export type CommissionReconciliation = {
  totalRevenueShare: number;
  attendanceDeduction: number;
  commissionableRevenue: number;
  commissionRate: number;
  grossCommission: number;
  formulaName: string;
  explanation: CommissionExplanation;
};

export type PayrollDrilldown = {
  dailySummary: DailySummaryLine[];
  transactions: CommissionBreakdown[];
  reconciliation: CommissionReconciliation | null;
};

// ── Salary Advances ─────────────────────────────────────────────────────────
// Mid-period cash advances to staff, tracked for payroll deduction.
// Defined ahead of payrollDeductions (moved up from below payrollDisbursements)
// so that table can hold a same-file, non-forward reference to salaryAdvances.id.
export const salaryAdvanceStatusEnum = ["pending", "approved", "rejected"] as const;
export type SalaryAdvanceStatus = typeof salaryAdvanceStatusEnum[number];

// The recovery lifecycle, distinct from the approval-workflow `status` column
// below. Mirrors credit_entries.status in spirit, scoped to just this: has
// payroll actually collected this specific advance, in full, in part, or not
// at all. `isRecovered` is kept as a convenience boolean defined as exactly
// (recoveryStatus === "recovered") — every existing reader (client included)
// already checks that one field, so it stays the single source of truth for
// "is this done", while recoveryStatus adds the "partial" state nothing else
// on this table could represent.
export const salaryAdvanceRecoveryStatusEnum = ["unrecovered", "partial", "recovered"] as const;
export type SalaryAdvanceRecoveryStatus = typeof salaryAdvanceRecoveryStatusEnum[number];

export const salaryAdvances = pgTable("salary_advances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  // The original, immutable claim — never mutated after creation. What's left
  // to collect lives in outstandingBalance, the same split credit_entries
  // draws between amountOwed and outstandingBalance.
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  notes: text("notes"),
  // What's still owed. Starts equal to `amount`; SalaryAdvanceDeductionService
  // decrements it by however much a period's available pay could actually
  // cover — never by more, so this never goes negative and an advance too big
  // for one paycheck simply gets re-proposed against its own remaining
  // balance next period, the same way an open credit_entries balance does.
  outstandingBalance: numeric("outstanding_balance", { precision: 12, scale: 2 }).$type<number>().notNull(),
  recoveryStatus: text("recovery_status").notNull().default("unrecovered"), // see salaryAdvanceRecoveryStatusEnum
  // Reserved to the period currently proposing/settling it — set by
  // SalaryAdvanceDeductionService.syncProposals as soon as a proposal is
  // written, so a second open period can't also propose the same remaining
  // balance. Cleared back to null the moment a period settles it only
  // partially (so the next period can pick up the remainder), and set to that
  // period's id once recoveryStatus reaches "recovered" — at that point it's
  // the permanent "recovered in period X" pointer. Also nulled if that period
  // is deleted or the proposal goes stale before settlement (see
  // PayrollRepository.deletePayrollPeriod).
  recoveredPeriodId: varchar("recovered_period_id").references(() => payrollPeriods.id),
  isRecovered: boolean("is_recovered").notNull().default(false),
  givenByUserId: varchar("given_by_user_id").references(() => users.id), // the requester
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id), // distinct from givenByUserId
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  // Reason given on the manual-override recovery path (POST
  // /api/payroll/advances/:id/recover) — an advance repaid or written off
  // outside payroll entirely. The normal path (payroll settling it) never
  // sets this, same as write-off vs. ordinary repayment on credit_entries.
  manualRecoveryReason: text("manual_recovery_reason"),
  // When the manual override above ran. Doubles as the existence check for
  // "was this manually recovered" (a payroll-settled recovery never sets it)
  // and the anchor for canRestoreManualRecovery's same-month window. Cleared
  // by the restore action.
  manualRecoveredAt: timestamp("manual_recovered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salaryAdvancesRelations = relations(salaryAdvances, ({ one }) => ({
  store: one(stores, { fields: [salaryAdvances.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [salaryAdvances.staffId], references: [staff.id] }),
  recoveredPeriod: one(payrollPeriods, { fields: [salaryAdvances.recoveredPeriodId], references: [payrollPeriods.id] }),
}));

export type SalaryAdvance = typeof salaryAdvances.$inferSelect;
export type InsertSalaryAdvance = typeof salaryAdvances.$inferInsert;

// ── Payroll Deductions ──────────────────────────────────────────────────────
// Per-staff deductions applied against gross pay before disbursement
export const payrollDeductionTypeEnum = [
  "tax", "insurance", "penalty", "late_arrival", "carry_forward", "advance_recovery", "staff_credit", "other",
] as const;
export type PayrollDeductionType = typeof payrollDeductionTypeEnum[number];

// Order in which deduction types claim a staff member's net pay when there
// isn't enough to cover everything. `staff_credit` is deliberately last so it
// absorbs the shortfall rather than crowding out statutory deductions — shop
// debt is the one line that can safely wait for the next period.
export const DEDUCTION_PRIORITY: readonly PayrollDeductionType[] = [
  "tax", "insurance", "penalty", "late_arrival", "carry_forward", "advance_recovery", "other", "staff_credit",
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
  // Set only for a system-proposed type = 'advance_recovery' line: the salary
  // advance this recovers. NULL for a manager's free-text advance_recovery
  // line (an advance predating this feature, or tracked outside
  // salary_advances) — those stay ordinary, hand-deletable deductions.
  salaryAdvanceId: varchar("salary_advance_id").references(() => salaryAdvances.id),
  // Stamped when settle() recovers the advance at mark-paid. Plays the same
  // idempotency-guard role repaymentId plays for staff_credit, minus a second
  // ledger row to point to — an advance has no repayments-table entry.
  settledAt: timestamp("settled_at"),
  // A manager excluding a proposed line. Must be a flag, not a DELETE: payroll
  // is auto-recalculated on every sale, so a deleted proposal would reappear.
  isWaived: boolean("is_waived").notNull().default(false),
  waivedByUserId: varchar("waived_by_user_id").references(() => users.id),
  waivedAt: timestamp("waived_at"),
  // Set only for type = 'late_arrival': the day that was clocked in late. One row
  // per date rather than an aggregate, so a manager can forgive a single day and
  // so the per-sale re-sync has a natural key to upsert against.
  lateDate: text("late_date"),
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
  salaryAdvance: one(salaryAdvances, { fields: [payrollDeductions.salaryAdvanceId], references: [salaryAdvances.id] }),
}));

export type PayrollDeduction = typeof payrollDeductions.$inferSelect;
export type InsertPayrollDeduction = typeof payrollDeductions.$inferInsert;

// ── Payroll Postings ────────────────────────────────────────────────────────
// Payroll's canonical record in the books — its "one door into the P&L".
//
// Before this, payroll cost was re-derived by every consumer straight from
// payroll_entries, each with its own status predicate and date convention, so
// the P&L, the analytics cube and the cash-flow statement disagreed about the
// same run. Worse, a period straddling a month boundary was reported in full in
// both months, because the P&L selected periods by overlap and then added the
// whole period total with nowhere to put a partial month.
//
// A paid period posts immutable lines here instead. Accounts:
//   wage_expense            gross earnings, split across the calendar months
//                           they were earned in
//   cash_out                what actually left the business, net of deductions
//   deduction:<type>        why those two differ
//   carry_forward_deferred  deductions that outran the pay available
export const payrollPostings = pgTable("payroll_postings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Nullable only for an advance_disbursement line: a salary advance is
  // disbursed before any payroll period exists to attach it to. Every other
  // posting still belongs to exactly one period, and postPeriod's
  // delete-and-replace (`WHERE period_id = X`) never touches a NULL row —
  // `period_id = X` cannot match NULL in SQL.
  periodId: varchar("period_id").references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  // Who the line is about. Carried so the analytics cube keeps its per-staff
  // dimension and so "what did we pay Ada, and why was it less than gross?" is
  // answerable from the ledger alone.
  staffId: varchar("staff_id").references(() => staff.id),
  account: text("account").notNull(),
  // Set only for account = 'advance_disbursement': the advance this posting
  // records. Its presence is what lets storage.deleteSalaryAdvance /
  // reject find and reverse exactly this posting rather than guessing by
  // staffId+date+amount.
  salaryAdvanceId: varchar("salary_advance_id").references(() => salaryAdvances.id),
  // ISO YYYY-MM-DD. Text rather than date to match every other local-date column
  // in this schema (attendance, expenses, period bounds), which the reporting
  // layer compares as strings against store-local wall-clock dates.
  effectiveDate: text("effective_date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_payroll_postings_store_account_date").on(table.storeId, table.account, table.effectiveDate),
  index("idx_payroll_postings_period").on(table.periodId),
  index("idx_payroll_postings_staff").on(table.staffId, table.account, table.effectiveDate),
  uniqueIndex("payroll_posting_salary_advance_unique").on(table.salaryAdvanceId),
]);

export const payrollPostingsRelations = relations(payrollPostings, ({ one }) => ({
  period: one(payrollPeriods, { fields: [payrollPostings.periodId], references: [payrollPeriods.id] }),
  store: one(stores, { fields: [payrollPostings.storeId], references: [stores.id] }),
  salaryAdvance: one(salaryAdvances, { fields: [payrollPostings.salaryAdvanceId], references: [salaryAdvances.id] }),
}));

export type PayrollPosting = typeof payrollPostings.$inferSelect;
export type InsertPayrollPosting = typeof payrollPostings.$inferInsert;

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
