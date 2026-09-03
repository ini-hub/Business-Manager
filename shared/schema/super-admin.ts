import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organisations } from "./organisations";

// --- SUPER ADMIN PORTAL TABLES ---

// Super Admins Table
export const superAdmins = pgTable("super_admins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  role: text("role").notNull().default("ops_manager"), // 'super_admin', 'ops_manager', 'support_agent', 'finance_admin'
  status: text("status").notNull().default("active"), // 'active', 'suspended', 'invited' (see migrations/0047_super_admin_invites.sql)
  otpCode: text("otp_code"),
  otpExpiry: timestamp("otp_expiry"),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  // Invite-onboarding fields (migration 0047), mirroring users.activationCode*
  // in shared/schema/auth.ts. Set on creation, cleared once the invitee has
  // both set their password and paired their own TOTP secret.
  activationCode: text("activation_code"),
  activationCodeExpiry: timestamp("activation_code_expiry"),
  activationCodeUsed: boolean("activation_code_used").notNull().default(false),
  resendAttempts: integer("resend_attempts").notNull().default(0),
  resendWindowStart: timestamp("resend_window_start"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const superAdminsRelations = relations(superAdmins, ({ many }) => ({
  auditLogs: many(superAdminAuditLogs),
}));

export const insertSuperAdminSchema = createInsertSchema(superAdmins).omit({ id: true, createdAt: true }).extend({
  email: z.string().email("Invalid email address"),
});
export type InsertSuperAdmin = z.infer<typeof insertSuperAdminSchema>;
export type SuperAdmin = typeof superAdmins.$inferSelect;

// Feature Flags Table
export const featureFlags = pgTable("feature_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").unique().notNull(),
  status: text("status").notNull().default("off"), // 'on', 'off', 'scoped', 'by_plan'
  scopedOrgIds: jsonb("scoped_org_ids"), // JSON array of business/organisation IDs
  subscriptionTier: text("subscription_tier"), // e.g. 'pro', 'premium' (optional plan scope)
  description: text("description").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"), // email of the admin who updated it
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({ id: true, updatedAt: true });
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;

// Announcements Table
export const announcements = pgTable("announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"), // 'info', 'warning', 'update', 'maintenance'
  target: text("target").notNull().default("all"), // 'all', 'active', 'specific_plan', 'specific_org'
  targetOrgId: varchar("target_org_id").references(() => organisations.id),
  showFrom: timestamp("show_from").notNull(),
  showUntil: timestamp("show_until").notNull(),
  dismissible: boolean("dismissible").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"), // email of the admin who created it
});

export const announcementsRelations = relations(announcements, ({ one }) => ({
  targetOrg: one(organisations, { fields: [announcements.targetOrgId], references: [organisations.id] }),
}));

export const insertAnnouncementSchema = createInsertSchema(announcements)
  .omit({ id: true, createdAt: true })
  .extend({
    title: z.string().min(1).max(80),
    message: z.string().min(1).max(150),
  });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

// Super Admin Audit Logs Table (Immutable Operations Ledger)
export const superAdminAuditLogs = pgTable("super_admin_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull().references(() => superAdmins.id),
  adminEmail: text("admin_email").notNull(),
  adminRole: text("admin_role").notNull(),
  action: text("action").notNull(), // e.g. 'suspend_business', 'reset_user_password', 'toggle_feature_flag'
  target: text("target").notNull(), // description/ID of the target affected resource
  ipAddress: text("ip_address").notNull(),
  details: jsonb("details"), // JSON payload detailing old/new parameters
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const superAdminAuditLogsRelations = relations(superAdminAuditLogs, ({ one }) => ({
  admin: one(superAdmins, { fields: [superAdminAuditLogs.adminId], references: [superAdmins.id] }),
}));

export const insertSuperAdminAuditLogSchema = createInsertSchema(superAdminAuditLogs).omit({ id: true, createdAt: true });
export type InsertSuperAdminAuditLog = z.infer<typeof insertSuperAdminAuditLogSchema>;
export type SuperAdminAuditLog = typeof superAdminAuditLogs.$inferSelect;
