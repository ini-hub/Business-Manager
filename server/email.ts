import { sendEmail as queueEmail, enqueueEmail } from "./services/EmailQueue";
import { escapeHtml, sanitizeHeaderValue } from "./sanitize";
import { getAppUrl } from "./lib/appUrl";

const BUSINESS_NAME = process.env.BUSINESS_NAME || "Business Manager";
const APP_URL = getAppUrl();

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export function sendEmail(payload: EmailPayload): void {
  queueEmail(payload);
}

const SUPPORT_INBOX_EMAIL = process.env.SUPPORT_INBOX_EMAIL || "bolujoexcellent@gmail.com";

/**
 * The one-shot "email us" path on the Help & Support page - unlike the
 * in-app chat (support_threads), there's no reply-ingestion, so this is
 * genuinely fire-and-forget: replyTo is set to the sender's own address so a
 * human agent can just hit reply in their own inbox.
 */
export function sendSupportRequestEmail(
  fromUserName: string,
  fromUserEmail: string,
  businessName: string,
  message: string,
  subject?: string
): void {
  const safeName = escapeHtml(fromUserName);
  const safeEmail = escapeHtml(fromUserEmail);
  const safeBusiness = escapeHtml(businessName);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">Support request from ${safeBusiness}</h2>
      <p><strong>From:</strong> ${safeName} (${safeEmail})</p>
      <p><strong>Business:</strong> ${safeBusiness}</p>
      <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0;">
        ${safeMessage}
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">Reply directly to this email to respond to ${safeName}.</p>
    </div>
  `;

  const headerSafeName = fromUserName.replace(/[\r\n"<>]/g, "").trim();

  sendEmail({
    to: SUPPORT_INBOX_EMAIL,
    subject: `Support request from ${sanitizeHeaderValue(businessName)} — ${sanitizeHeaderValue(subject) || "General inquiry"}`,
    html,
    replyTo: headerSafeName ? `"${headerSafeName}" <${fromUserEmail}>` : fromUserEmail,
  });
}

export async function sendActivationEmail(
  to: string,
  name: string,
  businessName: string,
  role: string,
  code: string
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const safeRole = escapeHtml(role);
  const safeCode = escapeHtml(code);
  const activationLink = `${APP_URL}/activate?code=${encodeURIComponent(code)}`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">You've been added to ${safeBusiness}</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>You have been added to <strong>${safeBusiness}</strong> as a <strong>${safeRole}</strong>.</p>
      <p>Use the activation code below when you first log in:</p>
      <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0; color: #111827;">
        ${safeCode}
      </div>
      <p>Or click the button below to go straight to the app to set up your password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${activationLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Activate My Account</a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">This link and code will expire in 48 hours. If you were not expecting this, you can safely ignore this email.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  // Awaited (unlike most senders here) so the staff invite path can report a
  // failure to queue back to the manager instead of silently dropping it.
  await enqueueEmail({
    to,
    subject: `You've been added to ${sanitizeHeaderValue(businessName)} — Activate your account`,
    html,
  });
}

export async function sendAddedToOrgEmail(
  to: string,
  name: string,
  businessName: string,
  role: string,
  inviterName: string
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const safeRole = escapeHtml(role);
  const safeInviter = escapeHtml(inviterName);
  const loginLink = `${APP_URL}/auth/login`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">You've been added to ${safeBusiness}</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p><strong>${safeInviter}</strong> has added you to <strong>${safeBusiness}</strong> as a <strong>${safeRole}</strong>.</p>
      <p>Log in with your existing credentials to accept and access this business workspace:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${loginLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Open Business Manager</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  // Awaited for the same reason as sendActivationEmail above.
  await enqueueEmail({
    to,
    subject: `You've been added to ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

const ADMIN_CONSOLE_NAME = "Business Manager Admin Console";

/**
 * Super admin invite. Mirrors sendActivationEmail's code-plus-link template,
 * but points at the admin portal's own activation route
 * (/super-admin/activate, not /activate) since AdminLogin.tsx is a fully
 * separate portal from the business-facing login state machine. Unlike
 * staff, there is no password in this email at all - the invitee sets one
 * themselves at the link, then pairs their own MFA secret, so nobody but
 * them ever sees either. See migrations/0047_super_admin_invites.sql.
 */
export async function sendAdminInviteEmail(to: string, name: string, role: string, code: string): Promise<void> {
  const safeName = escapeHtml(name);
  const safeRole = escapeHtml(role);
  const safeCode = escapeHtml(code);
  // Unlike the staff activation link (deliberately identifier-less to avoid
  // an enumeration oracle on a public-facing form - see StaffInviteService),
  // this is an internal admin console the recipient was already named by a
  // super admin, so prefilling the email is a plain convenience, not a leak.
  const activationLink = `${APP_URL}/super-admin/activate?code=${encodeURIComponent(code)}&email=${encodeURIComponent(to)}`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">You've been invited to the ${ADMIN_CONSOLE_NAME}</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>You've been granted administrative access as <strong>${safeRole}</strong>.</p>
      <p>Use the activation code below to set up your account:</p>
      <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0; color: #111827;">
        ${safeCode}
      </div>
      <p>Or click the button below to go straight to account setup, where you'll choose your own password and pair an authenticator app for MFA:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${activationLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Set Up My Admin Account</a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">This link and code will expire in 48 hours. If you were not expecting this, you can safely ignore this email.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${ADMIN_CONSOLE_NAME}</p>
    </div>
  `;

  // Awaited for the same reason as sendActivationEmail — the provisioning
  // admin's create-invite call can report a failure to queue back to them.
  await enqueueEmail({
    to,
    subject: `You've been invited to the ${ADMIN_CONSOLE_NAME}`,
    html,
  });
}

/**
 * Sent when a super_admin resets another admin's MFA. Replaces the old
 * behavior of returning the fresh secret/QR directly to whoever clicked
 * "Reset MFA" — the target admin re-pairs it themselves via the same
 * /super-admin/activate flow (skipping straight to the MFA step, since their
 * password is unaffected), so nobody but them ever sees the new secret.
 */
export async function sendAdminMfaResetEmail(to: string, name: string, code: string): Promise<void> {
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(code);
  const activationLink = `${APP_URL}/super-admin/activate?code=${encodeURIComponent(code)}&email=${encodeURIComponent(to)}`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #ef4444; margin-bottom: 20px;">Your MFA pairing was reset</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>Your authenticator pairing for the ${ADMIN_CONSOLE_NAME} was reset by another administrator. Use the code below to pair a new authenticator before you can log in again:</p>
      <div style="background-color: #fef2f2; border: 1px solid #fee2e2; padding: 15px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0; color: #b91c1c;">
        ${safeCode}
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${activationLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Re-pair My Authenticator</a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">This link and code will expire in 48 hours. If you did not expect this, contact another super admin immediately.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${ADMIN_CONSOLE_NAME}</p>
    </div>
  `;

  await enqueueEmail({
    to,
    subject: `Your MFA pairing was reset — ${ADMIN_CONSOLE_NAME}`,
    html,
  });
}

/**
 * Notifies the manager who invited a staff member that they declined to
 * sign their onboarding contract. Fire-and-forget from
 * StaffContractService.decline - a failure here must not block the decline
 * itself from being recorded.
 */
export async function sendContractDeclinedEmail(
  to: string,
  inviterName: string,
  staffName: string,
  businessName: string,
  reason?: string
): Promise<void> {
  const safeInviter = escapeHtml(inviterName);
  const safeStaff = escapeHtml(staffName);
  const safeBusiness = escapeHtml(businessName);
  const safeReason = reason ? escapeHtml(reason) : null;
  const staffLink = `${APP_URL}/staff`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #b91c1c; margin-bottom: 20px;">${safeStaff} declined their contract</h2>
      <p>Hi <strong>${safeInviter}</strong>,</p>
      <p><strong>${safeStaff}</strong> has declined to sign the contract you attached to their onboarding at <strong>${safeBusiness}</strong>. They will not gain access to the system until this is resolved.</p>
      ${safeReason ? `<div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0;"><strong>Reason given:</strong><br/>${safeReason.replace(/\n/g, "<br/>")}</div>` : ""}
      <p>You may want to reach out to them directly, revise the contract, or replace it from their staff profile.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${staffLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Staff</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  await enqueueEmail({
    to,
    subject: `${sanitizeHeaderValue(staffName)} declined their contract — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

/**
 * Tells an already-active staff member that a manager attached a contract
 * and checked "require signature" - they'll see the review-and-sign screen
 * the next time they log in (their current session, if any, is untouched
 * until then). Fire-and-forget from the POST /api/staff/:id/contract route.
 */
export async function sendContractSignatureRequiredEmail(
  to: string,
  staffName: string,
  businessName: string
): Promise<void> {
  const safeStaff = escapeHtml(staffName);
  const safeBusiness = escapeHtml(businessName);
  const loginLink = `${APP_URL}/auth/login`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">A contract needs your signature</h2>
      <p>Hi <strong>${safeStaff}</strong>,</p>
      <p>Your manager at <strong>${safeBusiness}</strong> has attached a contract that needs your review and signature. You'll be asked to sign it the next time you log in.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${loginLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Log In</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  await enqueueEmail({
    to,
    subject: `A contract needs your signature — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

export async function sendOtpEmail(
  to: string,
  name: string,
  code: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(code);
  const safeBusiness = escapeHtml(businessName);

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #ef4444; margin-bottom: 20px;">Reset your password</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>Your one-time password reset code is:</p>
      <div style="background-color: #fef2f2; border: 1px solid #fee2e2; padding: 15px; text-align: center; border-radius: 6px; font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 20px 0; color: #b91c1c;">
        ${safeCode}
      </div>
      <p>This code will expire in 10 minutes. Do not share this code with anyone.</p>
      <p style="color: #6b7280; font-size: 14px;">If you did not request this, you can safely ignore this email. Your password will remain unchanged.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: `Your password reset code — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

export async function sendPasswordChangedEmail(
  to: string,
  name: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #6a9ad9ff; margin-bottom: 20px;">Password Changed Successfully</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>Your password for Business Manager was successfully changed.</p>
      <p style="color: #dc2626; font-weight: bold;">If you did not make this change, contact your manager immediately or use Forgot Password on the login screen to secure your account.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: `Your password was changed — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

export async function sendEmailChangeNoticeToOldAddress(
  to: string,
  name: string,
  newEmail: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeNewEmail = escapeHtml(newEmail);
  const safeBusiness = escapeHtml(businessName);

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #b91c1c; margin-bottom: 20px;">Your account email is being changed</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>A request was made to change the email address on your account to <strong>${safeNewEmail}</strong>.</p>
      <p>This change will only take effect once the new address is verified. Until then, this email address remains your login.</p>
      <p style="color: #dc2626; font-weight: bold;">If you did not request this, contact your manager immediately or change your password now to secure your account.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: `Email change requested on your account — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

const TRIAL_REMINDER_COPY: Record<"3_days" | "2_days" | "today", { subject: string; headline: string; urgency: string }> = {
  "3_days": {
    subject: "Your free trial ends in 3 days",
    headline: "3 days left on your free trial",
    urgency: "Your trial ends in 3 days. Subscribe now to keep every feature working without interruption.",
  },
  "2_days": {
    subject: "Your free trial ends in 2 days",
    headline: "2 days left on your free trial",
    urgency: "Your trial ends in 2 days. Subscribe now to avoid losing access.",
  },
  "today": {
    subject: "Your free trial ends today",
    headline: "Your free trial ends today",
    urgency: "Your trial ends today. Once it does, the app locks until you subscribe — pick a plan now to keep things running.",
  },
};

export async function sendTrialReminderEmail(
  to: string,
  name: string,
  businessName: string,
  stage: "3_days" | "2_days" | "today"
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const copy = TRIAL_REMINDER_COPY[stage];
  const billingLink = `${APP_URL}/settings/billing`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #d97706; margin-bottom: 20px;">${copy.headline}</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>${copy.urgency}</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${billingLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Subscribe Now</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: copy.subject,
    html,
  });
}

const FEATURE_SUNSET_COPY: Record<"30_days" | "7_days" | "1_day" | "today", { subject: (feature: string) => string; headline: (feature: string) => string; urgency: (feature: string, date: string) => string }> = {
  "30_days": {
    subject: (feature) => `${feature} is becoming a paid add-on in 30 days`,
    headline: (feature) => `${feature} is moving behind the paywall`,
    urgency: (feature, date) => `You're currently using ${feature} for free. Starting ${date}, it'll need the ${feature} add-on to keep editing it — nothing changes before then, and anything you've already set up keeps working either way.`,
  },
  "7_days": {
    subject: (feature) => `7 days left on free access to ${feature}`,
    headline: (feature) => `${feature} becomes a paid add-on in 7 days`,
    urgency: (feature, date) => `On ${date}, ${feature} moves behind the paywall. Add it before then to avoid any interruption to editing it.`,
  },
  "1_day": {
    subject: (feature) => `${feature} becomes a paid add-on tomorrow`,
    headline: (feature) => `Last day of free access to ${feature}`,
    urgency: (feature, date) => `Tomorrow (${date}), ${feature} moves behind the paywall. Add it today to keep editing it without a gap.`,
  },
  "today": {
    subject: (feature) => `${feature} is now a paid add-on`,
    headline: (feature) => `${feature} has moved behind the paywall`,
    urgency: (feature) => `${feature} now needs its own add-on to keep editing. What you already set up (receipt prefix, roles, loyalty rates, etc.) keeps applying exactly as configured — you just can't change it further until you add the feature.`,
  },
};

/**
 * The §2.7 sunset-notice mechanism (pay-per-feature plan): a currently-free
 * feature is being paywalled on a public date, and this is one of the
 * staged reminders leading up to it. Mirrors sendTrialReminderEmail's shape.
 */
export async function sendFeatureSunsetReminderEmail(
  to: string,
  name: string,
  featureName: string,
  paywallEffectiveAt: Date,
  stage: "30_days" | "7_days" | "1_day" | "today"
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeFeature = escapeHtml(featureName);
  const copy = FEATURE_SUNSET_COPY[stage];
  const dateStr = paywallEffectiveAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const billingLink = `${APP_URL}/settings/billing`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #d97706; margin-bottom: 20px;">${copy.headline(safeFeature)}</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>${copy.urgency(safeFeature, dateStr)}</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${billingLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Keep ${safeFeature}</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The Business Manager Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: copy.subject(safeFeature),
    html,
  });
}

export async function sendAccountLockedEmail(
  to: string,
  name: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const unlockLink = `${APP_URL}/forgot-password`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #b91c1c; margin-bottom: 20px;">Account Locked</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>Your account was locked after too many failed login attempts.</p>
      <p>It will automatically unlock after <strong>30 minutes</strong>.</p>
      <p>To unlock immediately, reset your password using the link below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${unlockLink}" style="background-color: #b91c1c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: `Your account has been locked — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

// Returns whether the message was actually handed off to a provider, so
// callers that depend on SMS as their only delivery channel (no email
// fallback available) can detect failure and tell the user, instead of
// silently claiming success for a code that will never arrive.
export async function sendSMS(_phone: string, _textContent: string): Promise<boolean> {
  // SMS provider not yet integrated
  return false;
}

export async function sendEmailVerificationOtpEmail(
  to: string,
  name: string,
  code: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(code);
  const safeBusiness = escapeHtml(businessName);

  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">Verify your email address</h2>
      <p>Hi <strong>${safeName}</strong>,</p>
      <p>Your one-time email verification code is:</p>
      <div style="background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 15px; text-align: center; border-radius: 6px; font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 20px 0; color: #4f46e5;">
        ${safeCode}
      </div>
      <p>This code will expire in 10 minutes. Do not share this code with anyone.</p>
      <p style="color: #6b7280; font-size: 14px;">If you did not request this, you can safely ignore this email.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${safeBusiness} Team</p>
    </div>
  `;

  sendEmail({
    to,
    subject: `Your email verification code — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}
