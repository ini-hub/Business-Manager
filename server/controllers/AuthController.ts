import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage, serializeUser } from "../storage";
import { isAuthenticated } from "../auth";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { normalizePhoneForStorage } from "@shared/phone-utils";
import { validateEmailFormat } from "../sanitize";
import { sendEmailVerificationOtpEmail, sendEmailChangeNoticeToOldAddress, sendSMS } from "../email";
import { getViolatedConstraint } from "../db-errors";
import { checkResendCooldown, MAX_OTP_ATTEMPTS } from "../lib/otp-cooldown";
import { syncUserIdentityToLinkedStaff } from "../services/IdentitySync";
import type { User } from "@shared/schema";

const SALT_ROUNDS = 12;
const EMAIL_CHANGE_OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_EMAIL_CHANGE_OTP_ATTEMPTS = MAX_OTP_ATTEMPTS;
const PHONE_CHANGE_OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_PHONE_CHANGE_OTP_ATTEMPTS = MAX_OTP_ATTEMPTS;

export class AuthController extends BaseController {
  public register(router: Router): void {
    // Health check
    router.get("/health", this.healthCheck.bind(this));

    // Profile updates
    router.patch("/auth/user/profile", isAuthenticated, this.updateProfile.bind(this));
    router.post("/auth/user/change-password", isAuthenticated, this.changePassword.bind(this));
    router.post("/auth/user/change-email", isAuthenticated, this.requestEmailChange.bind(this));
    router.post("/auth/user/verify-email-change", isAuthenticated, this.verifyEmailChange.bind(this));
    router.post("/auth/user/change-phone", isAuthenticated, this.requestPhoneChange.bind(this));
    router.post("/auth/user/verify-phone-change", isAuthenticated, this.verifyPhoneChange.bind(this));
  }

  private healthCheck(req: Request, res: Response): Response {
    return this.ok(res, { status: "ok", timestamp: new Date().toISOString() });
  }

  private async updateProfile(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { name, profilePhotoUrl } = req.body;

      // Phone (like email) is changed only through the dedicated OTP-verified
      // change-phone flow below - see requestPhoneChange/verifyPhoneChange.
      // This endpoint must not accept a bare `phone` field, or it would let
      // someone swap in a new number with no verification step at all.
      const updates: Partial<User> = { name, profilePhotoUrl };

      const updated = await storage.updateUser(userId, updates);

      // Keep every staff row this account is linked to in step - see
      // IdentitySync. Only when the caller actually sent a name: an
      // undefined name here means "leave it alone", not "clear it".
      if (name !== undefined) {
        await syncUserIdentityToLinkedStaff(userId, { name });
      }

      return this.ok(res, serializeUser(updated));
    } catch (error) {
      return this.error(res, "Could not update profile.");
    }
  }

  private async changePassword(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { currentPassword, newPassword } = req.body;

      const user = await storage.getUser(userId);
      if (!user) return this.notFound(res, "User not found.");

      const isMatch = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
      if (!isMatch) return this.badRequest(res, "Incorrect current password.");

      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await storage.updateUser(userId, { password: hashedPassword });

      return this.ok(res, { message: "Password updated successfully." });
    } catch (error) {
      return this.error(res, "Could not change password.");
    }
  }

  private async requestEmailChange(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { newEmail, currentPassword } = req.body;

      if (!newEmail || !currentPassword) {
        return this.badRequest(res, "New email and current password are required.");
      }
      const normalizedNewEmail = String(newEmail).trim().toLowerCase();
      if (!validateEmailFormat(normalizedNewEmail)) {
        return this.badRequest(res, "Please enter a valid email address.");
      }

      const user = await storage.getUser(userId);
      if (!user) return this.notFound(res, "User not found.");

      const isMatch = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
      if (!isMatch) return this.badRequest(res, "Incorrect current password.");

      if (user.email && normalizedNewEmail === user.email.toLowerCase()) {
        return this.badRequest(res, "This is already your current email address.");
      }

      const existing = await storage.getUserByIdentifier(normalizedNewEmail);
      if (existing && existing.id !== userId) {
        return this.badRequest(res, "This email address is already linked to another account.");
      }

      // Also covers "resend" and "restart with a different email" - both
      // just call this endpoint again, so both share the same cooldown.
      const cooldown = checkResendCooldown(user.pendingEmailOtpResendAttempts, user.pendingEmailOtpResendWindowStart);
      if (!cooldown.allowed) {
        return this.badRequest(res, `Too many code requests. Please try again in ${cooldown.retryAfterMinutes} minutes.`);
      }

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const otpExpiry = new Date(Date.now() + EMAIL_CHANGE_OTP_EXPIRY_MS);

      await storage.updateUser(userId, {
        pendingEmail: normalizedNewEmail,
        pendingEmailOtp: otpCode,
        pendingEmailOtpExpiry: otpExpiry,
        pendingEmailOtpAttempts: 0,
        pendingEmailOtpResendAttempts: cooldown.nextAttempts,
        pendingEmailOtpResendWindowStart: cooldown.nextWindowStart,
      });

      await sendEmailVerificationOtpEmail(normalizedNewEmail, user.name || normalizedNewEmail, otpCode);
      if (user.email) {
        await sendEmailChangeNoticeToOldAddress(user.email, user.name || user.email, normalizedNewEmail);
      }

      return this.ok(res, {
        message: "A verification code has been sent to your new email address.",
        pendingEmail: normalizedNewEmail,
      });
    } catch (error) {
      return this.error(res, "Could not start email change.");
    }
  }

  private async verifyEmailChange(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { otp } = req.body;
      if (!otp) return this.badRequest(res, "OTP is required.");

      const user = await storage.getUser(userId);
      if (!user) return this.notFound(res, "User not found.");
      if (!user.pendingEmail || !user.pendingEmailOtp) {
        return this.badRequest(res, "No email change is in progress.");
      }

      if ((user.pendingEmailOtpAttempts ?? 0) >= MAX_EMAIL_CHANGE_OTP_ATTEMPTS) {
        return this.badRequest(res, "Too many attempts. Please request a new code.");
      }

      const otpMatch = otp.length === user.pendingEmailOtp.length &&
        crypto.timingSafeEqual(Buffer.from(user.pendingEmailOtp), Buffer.from(otp));

      if (!otpMatch) {
        await storage.updateUser(userId, { pendingEmailOtpAttempts: (user.pendingEmailOtpAttempts ?? 0) + 1 });
        return this.badRequest(res, "Invalid verification code.");
      }
      if (user.pendingEmailOtpExpiry && new Date() > new Date(user.pendingEmailOtpExpiry)) {
        return this.badRequest(res, "This code has expired. Please request a new one.");
      }

      // Re-check uniqueness at swap time to close the request-to-confirm race window.
      const existing = await storage.getUserByIdentifier(user.pendingEmail);
      if (existing && existing.id !== userId) {
        await storage.updateUser(userId, {
          pendingEmail: null,
          pendingEmailOtp: null,
          pendingEmailOtpExpiry: null,
          pendingEmailOtpAttempts: 0,
        });
        return this.badRequest(res, "This email address was just claimed by another account. Please start over with a different email.");
      }

      const updated = await storage.updateUser(userId, {
        email: user.pendingEmail,
        isEmailVerified: true,
        pendingEmail: null,
        pendingEmailOtp: null,
        pendingEmailOtpExpiry: null,
        pendingEmailOtpAttempts: 0,
      });

      // Keep every staff row this account is linked to in step - see
      // IdentitySync. Without this, self-servicing a login email here would
      // leave staff.email (the HR record) permanently stale.
      await syncUserIdentityToLinkedStaff(userId, { email: user.pendingEmail });

      return this.ok(res, serializeUser(updated));
    } catch (error) {
      // Defense-in-depth for the sliver of time between the re-check above
      // and this write - falls back to the DB constraint if another
      // request slipped in during that window.
      if (getViolatedConstraint(error) === "users_email_unique") {
        return this.badRequest(res, "This email address is already linked to another account.");
      }
      return this.error(res, "Could not verify email change.");
    }
  }

  private async requestPhoneChange(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { newPhone, phoneCountryCode, currentPassword } = req.body;

      if (!newPhone || !phoneCountryCode || !currentPassword) {
        return this.badRequest(res, "New phone number, country code, and current password are required.");
      }

      const user = await storage.getUser(userId);
      if (!user) return this.notFound(res, "User not found.");

      const isMatch = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
      if (!isMatch) return this.badRequest(res, "Incorrect current password.");

      const normalizedNewPhone = normalizePhoneForStorage(newPhone, phoneCountryCode);
      if (user.phone && normalizedNewPhone === user.phone) {
        return this.badRequest(res, "This is already your current phone number.");
      }

      const existing = await storage.getUserByIdentifier(normalizedNewPhone);
      if (existing && existing.id !== userId) {
        return this.badRequest(res, "This phone number is already linked to another account.");
      }

      // Also covers "resend" and "restart with a different number" - both
      // just call this endpoint again, so both share the same cooldown.
      const cooldown = checkResendCooldown(user.pendingPhoneOtpResendAttempts, user.pendingPhoneOtpResendWindowStart);
      if (!cooldown.allowed) {
        return this.badRequest(res, `Too many code requests. Please try again in ${cooldown.retryAfterMinutes} minutes.`);
      }

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const otpExpiry = new Date(Date.now() + PHONE_CHANGE_OTP_EXPIRY_MS);

      // A phone-change code can only go to the new number - there's no email
      // fallback the way other OTP flows have. Check delivery before writing
      // any pending-phone state (and before consuming the resend cooldown),
      // so a failed send never leaves the account "waiting" on a code that
      // was never sent.
      const delivered = await sendSMS(normalizedNewPhone, `Your verification code is: ${otpCode}. Valid for 10 minutes.`);
      if (!delivered) {
        return res.status(503).json({
          error: {
            code: "SMS_UNAVAILABLE",
            message: "We're unable to send an SMS verification code right now. Please try again later.",
          },
        });
      }

      await storage.updateUser(userId, {
        pendingPhone: normalizedNewPhone,
        pendingPhoneOtp: otpCode,
        pendingPhoneOtpExpiry: otpExpiry,
        pendingPhoneOtpAttempts: 0,
        pendingPhoneOtpResendAttempts: cooldown.nextAttempts,
        pendingPhoneOtpResendWindowStart: cooldown.nextWindowStart,
      });

      return this.ok(res, {
        message: "A verification code has been sent to your new phone number.",
        pendingPhone: normalizedNewPhone,
      });
    } catch (error) {
      return this.error(res, "Could not start phone number change.");
    }
  }

  private async verifyPhoneChange(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { otp } = req.body;
      if (!otp) return this.badRequest(res, "OTP is required.");

      const user = await storage.getUser(userId);
      if (!user) return this.notFound(res, "User not found.");
      if (!user.pendingPhone || !user.pendingPhoneOtp) {
        return this.badRequest(res, "No phone number change is in progress.");
      }

      if ((user.pendingPhoneOtpAttempts ?? 0) >= MAX_PHONE_CHANGE_OTP_ATTEMPTS) {
        return this.badRequest(res, "Too many attempts. Please request a new code.");
      }

      const otpMatch = otp.length === user.pendingPhoneOtp.length &&
        crypto.timingSafeEqual(Buffer.from(user.pendingPhoneOtp), Buffer.from(otp));

      if (!otpMatch) {
        await storage.updateUser(userId, { pendingPhoneOtpAttempts: (user.pendingPhoneOtpAttempts ?? 0) + 1 });
        return this.badRequest(res, "Invalid verification code.");
      }
      if (user.pendingPhoneOtpExpiry && new Date() > new Date(user.pendingPhoneOtpExpiry)) {
        return this.badRequest(res, "This code has expired. Please request a new one.");
      }

      // Re-check uniqueness at swap time to close the request-to-confirm race window.
      const existing = await storage.getUserByIdentifier(user.pendingPhone);
      if (existing && existing.id !== userId) {
        await storage.updateUser(userId, {
          pendingPhone: null,
          pendingPhoneOtp: null,
          pendingPhoneOtpExpiry: null,
          pendingPhoneOtpAttempts: 0,
        });
        return this.badRequest(res, "This phone number was just claimed by another account. Please start over with a different number.");
      }

      const updated = await storage.updateUser(userId, {
        phone: user.pendingPhone,
        isPhoneVerified: true,
        pendingPhone: null,
        pendingPhoneOtp: null,
        pendingPhoneOtpExpiry: null,
        pendingPhoneOtpAttempts: 0,
      });

      return this.ok(res, serializeUser(updated));
    } catch (error) {
      // Defense-in-depth for the sliver of time between the re-check above
      // and this write - falls back to the DB constraint if another
      // request slipped in during that window.
      if (getViolatedConstraint(error) === "users_phone_unique") {
        return this.badRequest(res, "This phone number is already linked to another account.");
      }
      return this.error(res, "Could not verify phone number change.");
    }
  }
}
