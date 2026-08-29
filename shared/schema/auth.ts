import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { businesses, organisations, type Business } from "./organisations";
import { notifications } from "./notifications";
import { trimmedString } from "./_helpers";

// Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles enum
export const userRoleEnum = ["owner", "manager", "staff"] as const;
export type UserRole = typeof userRoleEnum[number];

// User storage table with platform-level auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"), // Display name
  email: text("email").unique(), // Nullable for phone-only users
  phone: text("phone").unique(), // Nullable for email-only users
  password: text("password"), // Legacy hashed password field
  passwordHash: text("password_hash"), // Specified hashed password field
  businessId: varchar("business_id"), // Legacy reference
  role: text("role").notNull().default("owner"), // Legacy role
  isVerified: boolean("is_verified").notNull().default(false), // Legacy isVerified
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  isPhoneVerified: boolean("is_phone_verified").notNull().default(false),
  profilePhotoUrl: text("profile_photo_url"),

  // Custom specifications fields
  activationCode: text("activation_code"),
  activationCodeExpiry: timestamp("activation_code_expiry"),
  activationCodeUsed: boolean("activation_code_used").notNull().default(false),
  createdByInvitation: boolean("created_by_invitation").notNull().default(false),
  otpCode: text("otp_code"),
  otpExpiry: timestamp("otp_expiry"),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  // Resend rate-limit for the shared otpCode/otpExpiry pair above
  // (login/signup/forgot-password all funnel through this one column pair,
  // so one shared cooldown covers all of them).
  otpResendAttempts: integer("otp_resend_attempts").notNull().default(0),
  otpResendWindowStart: timestamp("otp_resend_window_start"),

  // Email-change staging: new email sits here until its own OTP is
  // confirmed. Kept separate from otpCode/otpExpiry above, which are
  // already shared by concurrent login/password-reset OTP flows on the
  // same row - see migrations/0034_users_phone_uniqueness_and_pending_email.sql
  pendingEmail: text("pending_email"),
  pendingEmailOtp: text("pending_email_otp"),
  pendingEmailOtpExpiry: timestamp("pending_email_otp_expiry"),
  pendingEmailOtpAttempts: integer("pending_email_otp_attempts").notNull().default(0),
  pendingEmailOtpResendAttempts: integer("pending_email_otp_resend_attempts").notNull().default(0),
  pendingEmailOtpResendWindowStart: timestamp("pending_email_otp_resend_window_start"),

  // Phone-change staging - mirrors the pendingEmail* group above.
  pendingPhone: text("pending_phone"),
  pendingPhoneOtp: text("pending_phone_otp"),
  pendingPhoneOtpExpiry: timestamp("pending_phone_otp_expiry"),
  pendingPhoneOtpAttempts: integer("pending_phone_otp_attempts").notNull().default(0),
  pendingPhoneOtpResendAttempts: integer("pending_phone_otp_resend_attempts").notNull().default(0),
  pendingPhoneOtpResendWindowStart: timestamp("pending_phone_otp_resend_window_start"),

  loginAttempts: integer("login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  // Consecutive lockout count, used to escalate lockedUntil duration on
  // repeat offenses. Reset to 0 on a successful login.
  lockoutCount: integer("lockout_count").notNull().default(0),
  lastLoginAt: timestamp("last_login_at"),

  // Resend activation code rate-limit (replaces in-memory resendLimitMap)
  resendAttempts: integer("resend_attempts").notNull().default(0),
  resendWindowStart: timestamp("resend_window_start"),

  // Supervisor override rate-limit (replaces in-memory supervisorLockoutMap)
  supervisorAttempts: integer("supervisor_attempts").notNull().default(0),
  supervisorLockedUntil: timestamp("supervisor_locked_until"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  status: text("status").notNull().default("active"), // 'active', 'pending', 'locked', 'deactivated'
  suspensionReason: text("suspension_reason"),
  suspendedAt: timestamp("suspended_at"),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  business: one(businesses, {
    fields: [users.businessId],
    references: [businesses.id],
  }),
  notifications: many(notifications),
  organisationMembers: many(organisationMembers),
}));

// Organisation Members Table
export const organisationMembers = pgTable("organisation_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  role: text("role").notNull().default("staff"), // 'owner', 'manager', 'staff'
  staffId: text("staff_id"), // e.g. "EXB-001" internal label
  status: text("status").notNull().default("pending"), // 'pending', 'partial', 'active', 'locked', 'deactivated'
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("org_member_user_org_unique").on(table.userId, table.organisationId),
]);

export const organisationMembersRelations = relations(organisationMembers, ({ one }) => ({
  user: one(users, {
    fields: [organisationMembers.userId],
    references: [users.id],
  }),
  organisation: one(organisations, {
    fields: [organisationMembers.organisationId],
    references: [organisations.id],
  }),
  invitedBy: one(users, {
    fields: [organisationMembers.invitedByUserId],
    references: [users.id],
  }),
}));

export type InsertOrganisationMember = typeof organisationMembers.$inferInsert;
export type OrganisationMember = typeof organisationMembers.$inferSelect;

// Password complexity validation schema
export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one symbol")
  .regex(/^\S*$/, "Password must not contain spaces");

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  email: z.string().email("Invalid email address").optional(),
  password: passwordSchema.optional(),
  role: z.enum(userRoleEnum).default("owner"),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// OTP codes table for verification
export const otpCodes = pgTable("otp_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  code: varchar("code", { length: 6 }).notNull(),
  type: text("type").notNull(), // signup, password_reset
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const otpCodesRelations = relations(otpCodes, ({ one }) => ({
  user: one(users, {
    fields: [otpCodes.userId],
    references: [users.id],
  }),
}));

export const insertOtpCodeSchema = createInsertSchema(otpCodes).omit({ id: true, createdAt: true });
export type InsertOtpCode = z.infer<typeof insertOtpCodeSchema>;
export type OtpCode = typeof otpCodes.$inferSelect;

// Signup request schema (combines business + user info)
export const signupSchema = z.object({
  ownerName: z.string().trim().optional(),
  businessName: trimmedString(1, "Business name is required"),
  address: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});
export type SignupRequest = z.infer<typeof signupSchema>;

// Login schema
export const loginSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
  password: z.string().min(1, "Password is required"),
  stayLoggedIn: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof loginSchema>;

// Forgot password schema
export const forgotPasswordSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

// Reset password schema
export const resetPasswordSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

// OTP verification schema
export const verifyOtpSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpSchema>;

// User with business relation
export type UserWithBusiness = User & {
  business: Business | null;
};
