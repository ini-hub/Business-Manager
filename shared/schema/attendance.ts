import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, jsonb, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { staff } from "./staff";
import { users } from "./auth";

// ========== SELF-SERVICE CLOCK-IN ==========
// See migrations/0038_geofenced_clock_in.sql for the reasoning behind the shape
// of these tables. In short: attendance_records stays the one-row-per-day
// summary the payroll engine reads, and these tables carry the event detail
// that cannot fit under its UNIQUE (store, staff, date) key.

export const punchKindEnum = ["clock_in", "clock_out"] as const;
export type PunchKind = typeof punchKindEnum[number];

export const punchSourceEnum = ["self", "manager_proxy", "retro_approved", "offline_replay"] as const;
export type PunchSource = typeof punchSourceEnum[number];

// Append-only log of every clock-in and clock-out.
export const attendancePunches = pgTable("attendance_punches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  // Store-local calendar date, resolved server-side. Never taken from the client.
  localDate: text("local_date").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
  // The instant all lateness maths uses.
  effectiveAt: timestamp("effective_at").notNull(),
  serverReceivedAt: timestamp("server_received_at").notNull().defaultNow(),
  clientCapturedAt: timestamp("client_captured_at"),
  clockSkewSeconds: integer("clock_skew_seconds"),
  // A flagged punch may never clear a late flag on its own — only a manager can.
  timeDivergenceFlagged: boolean("time_divergence_flagged").notNull().default(false),
  latitude: numeric("latitude", { precision: 9, scale: 6 }).$type<number>(),
  longitude: numeric("longitude", { precision: 9, scale: 6 }).$type<number>(),
  accuracyMeters: numeric("accuracy_meters", { precision: 8, scale: 2 }).$type<number>(),
  distanceMeters: numeric("distance_meters", { precision: 10, scale: 2 }).$type<number>(),
  withinGeofence: boolean("within_geofence"),
  // The geofence cannot tell five arrivals from one person holding five logins,
  // because both are inside it. The device identity can.
  deviceId: varchar("device_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  deviceTrusted: boolean("device_trusted").notNull().default(false),
  sharedDeviceFlagged: boolean("shared_device_flagged").notNull().default(false),
  // Idempotency key for a service worker replaying a queued punch.
  clientPunchId: varchar("client_punch_id"),
  reason: text("reason"),
  recordedByUserId: varchar("recorded_by_user_id").references(() => users.id),
  voidedAt: timestamp("voided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_attendance_punches_store_date").on(table.storeId, table.localDate),
  index("idx_attendance_punches_staff_date").on(table.staffId, table.localDate),
  uniqueIndex("attendance_punch_client_id_unique").on(table.staffId, table.clientPunchId),
  uniqueIndex("attendance_punch_day_kind_unique").on(table.staffId, table.localDate, table.kind),
]);

export const attendancePunchesRelations = relations(attendancePunches, ({ one }) => ({
  store: one(stores, { fields: [attendancePunches.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [attendancePunches.staffId], references: [staff.id] }),
  recordedByUser: one(users, { fields: [attendancePunches.recordedByUserId], references: [users.id] }),
}));

export type AttendancePunch = typeof attendancePunches.$inferSelect;
export type InsertAttendancePunch = typeof attendancePunches.$inferInsert;

// Devices a staff member has punched from. First punch binds; an unrecognised
// device is allowed but flagged, never blocked — localStorage gets cleared and
// evicted, and blocking would manufacture a support call each time.
export const staffDevices = pgTable("staff_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  deviceId: varchar("device_id").notNull(),
  label: text("label"),
  userAgent: text("user_agent"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  punchCount: integer("punch_count").notNull().default(0),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("staff_device_unique").on(table.staffId, table.deviceId),
  index("idx_staff_devices_store").on(table.storeId),
]);

export const staffDevicesRelations = relations(staffDevices, ({ one }) => ({
  store: one(stores, { fields: [staffDevices.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [staffDevices.staffId], references: [staff.id] }),
}));

export type StaffDevice = typeof staffDevices.$inferSelect;
export type InsertStaffDevice = typeof staffDevices.$inferInsert;

// The escape hatch from a hard geofence block.
export const retroRequestStatusEnum = ["pending", "approved", "rejected"] as const;
export type RetroRequestStatus = typeof retroRequestStatusEnum[number];

export const attendanceRetroRequests = pgTable("attendance_retro_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  date: text("date").notNull(),
  requestedKind: text("requested_kind").notNull().default("clock_in"),
  requestedAt: timestamp("requested_at").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  // Lets a manager restore the day without also forgiving the lateness, or
  // forgive both — the two decisions are genuinely separate.
  clearsLateFlag: boolean("clears_late_flag").notNull().default(false),
  decidedByUserId: varchar("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  createdPunchId: varchar("created_punch_id").references(() => attendancePunches.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("attendance_retro_request_pending_unique").on(table.staffId, table.date),
  index("idx_attendance_retro_requests_store_status").on(table.storeId, table.status),
]);

export const attendanceRetroRequestsRelations = relations(attendanceRetroRequests, ({ one }) => ({
  store: one(stores, { fields: [attendanceRetroRequests.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [attendanceRetroRequests.staffId], references: [staff.id] }),
  decidedByUser: one(users, { fields: [attendanceRetroRequests.decidedByUserId], references: [users.id] }),
}));

export const insertAttendanceRetroRequestSchema = createInsertSchema(attendanceRetroRequests)
  .omit({ id: true, createdAt: true, status: true, decidedByUserId: true, decidedAt: true, createdPunchId: true })
  .extend({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    reason: z.string().trim().min(1, "A reason is required"),
    requestedKind: z.enum(punchKindEnum).default("clock_in"),
  });
export type AttendanceRetroRequest = typeof attendanceRetroRequests.$inferSelect;
export type InsertAttendanceRetroRequest = typeof attendanceRetroRequests.$inferInsert;

// ── Rosters ─────────────────────────────────────────────────────────────────
// Day numbers are 0 = Sunday, matching Date#getUTCDay so the roster reads the
// same way dayOfWeekForLocalDate does.
export const weeklyOffDaysSchema = z.array(z.number().int().min(0).max(6));

export const staffSchedules = pgTable("staff_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  weeklyOffDays: jsonb("weekly_off_days").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("staff_schedule_staff_unique").on(table.staffId),
]);

export const staffSchedulesRelations = relations(staffSchedules, ({ one }) => ({
  store: one(stores, { fields: [staffSchedules.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [staffSchedules.staffId], references: [staff.id] }),
}));

export type StaffSchedule = typeof staffSchedules.$inferSelect;
export type InsertStaffSchedule = typeof staffSchedules.$inferInsert;

export const scheduleExceptionKindEnum = ["off", "working"] as const;
export type ScheduleExceptionKind = typeof scheduleExceptionKindEnum[number];

// A specific date overriding the weekly pattern, in either direction. Salons swap
// days constantly and a pure weekly pattern cannot express a swap.
export const staffScheduleExceptions = pgTable("staff_schedule_exceptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  date: text("date").notNull(),
  kind: text("kind").notNull(),
  reason: text("reason"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("staff_schedule_exception_unique").on(table.staffId, table.date),
  index("idx_staff_schedule_exceptions_store_date").on(table.storeId, table.date),
]);

export const staffScheduleExceptionsRelations = relations(staffScheduleExceptions, ({ one }) => ({
  store: one(stores, { fields: [staffScheduleExceptions.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [staffScheduleExceptions.staffId], references: [staff.id] }),
}));

export const insertStaffScheduleExceptionSchema = createInsertSchema(staffScheduleExceptions)
  .omit({ id: true, createdAt: true })
  .extend({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    kind: z.enum(scheduleExceptionKindEnum),
  });
export type StaffScheduleException = typeof staffScheduleExceptions.$inferSelect;
export type InsertStaffScheduleException = typeof staffScheduleExceptions.$inferInsert;
