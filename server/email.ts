import { sendEmail as queueEmail, enqueueEmail } from "./services/EmailQueue";
import { escapeHtml, sanitizeHeaderValue } from "./sanitize";
import { getAppUrl } from "./lib/appUrl";
import { callout, codeBlock, muted, para, renderEmail, warn } from "./lib/emailLayout";

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

  const html = renderEmail({
    heading: `Support request from ${safeBusiness}`,
    preheader: `${fromUserName} sent a message from ${businessName}`,
    body:
      para(`<strong>From:</strong> ${safeName} (${safeEmail})<br/><strong>Business:</strong> ${safeBusiness}`) +
      callout(safeMessage),
    afterButton: muted(`Reply directly to this email to respond to ${safeName}.`),
    signoff: "Kowope support inbox",
  });

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

  const html = renderEmail({
    heading: `You've been added to ${safeBusiness}`,
    preheader: `Activate your account with code ${code}`,
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para(`You have been added to <strong>${safeBusiness}</strong> as a <strong>${safeRole}</strong>.`) +
      para("Use the activation code below when you first log in:") +
      codeBlock(safeCode) +
      para("Or use the button below to go straight to the app and set up your password:"),
    button: { label: "Activate my account", href: activationLink },
    afterButton: muted("This link and code expire in 48 hours. If you weren't expecting this, you can safely ignore this email."),
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    heading: `You've been added to ${safeBusiness}`,
    preheader: `${inviterName} added you to ${businessName}`,
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para(`<strong>${safeInviter}</strong> has added you to <strong>${safeBusiness}</strong> as a <strong>${safeRole}</strong>.`) +
      para("Log in with your existing credentials to accept and access this business workspace."),
    button: { label: "Open Kowope", href: loginLink },
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    heading: `You've been invited to the ${ADMIN_CONSOLE_NAME}`,
    preheader: `Set up your admin account with code ${code}`,
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para(`You've been granted administrative access as <strong>${safeRole}</strong>.`) +
      para("Use the activation code below to set up your account:") +
      codeBlock(safeCode) +
      para("Or use the button below to go straight to account setup, where you'll choose your own password and pair an authenticator app for MFA:"),
    button: { label: "Set up my admin account", href: activationLink },
    afterButton: muted("This link and code expire in 48 hours. If you weren't expecting this, you can safely ignore this email."),
    signoff: ADMIN_CONSOLE_NAME,
  });

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

  const html = renderEmail({
    tone: "danger",
    heading: "Your MFA pairing was reset",
    preheader: "Pair a new authenticator before you log in again",
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para(`Your authenticator pairing for the ${ADMIN_CONSOLE_NAME} was reset by another administrator. Use the code below to pair a new authenticator before you can log in again:`) +
      codeBlock(safeCode, "danger"),
    button: { label: "Re-pair my authenticator", href: activationLink },
    afterButton: muted("This link and code expire in 48 hours. If you did not expect this, contact another super admin immediately."),
    signoff: ADMIN_CONSOLE_NAME,
  });

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

  const html = renderEmail({
    tone: "danger",
    heading: `${safeStaff} declined their contract`,
    preheader: `${staffName} will not get access until this is resolved`,
    body:
      para(`Hi <strong>${safeInviter}</strong>,`) +
      para(`<strong>${safeStaff}</strong> has declined to sign the contract you attached to their onboarding at <strong>${safeBusiness}</strong>. They will not gain access to the system until this is resolved.`) +
      (safeReason ? callout(`<strong>Reason given:</strong><br/>${safeReason.replace(/\n/g, "<br/>")}`, "danger") : "") +
      para("You may want to reach out to them directly, revise the contract, or replace it from their staff profile."),
    button: { label: "View staff", href: staffLink },
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    heading: "A contract needs your signature",
    preheader: `Your manager at ${businessName} attached a contract`,
    body:
      para(`Hi <strong>${safeStaff}</strong>,`) +
      para(`Your manager at <strong>${safeBusiness}</strong> has attached a contract that needs your review and signature. You'll be asked to sign it the next time you log in.`),
    button: { label: "Log in", href: loginLink },
    signoff: `The ${safeBusiness} Team`,
  });

  await enqueueEmail({
    to,
    subject: `A contract needs your signature — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}

/**
 * Delivers the guarantor signing link to the actual guarantor - the only
 * automatic delivery channel for it (the employee can also copy/share the
 * link manually from client/src/components/hr/GuarantorTab.tsx). Fire-and-
 * forget from the guarantor/initiate routes (server/routes/hr.routes.ts,
 * server/routes/profile-completion.routes.ts); a delivery failure here must
 * never block the employee's own submission from being recorded, which is
 * why callers wrap this in its own try/catch rather than awaiting it inline
 * with the rest of the request.
 */
export async function sendGuarantorSigningRequestEmail(
  to: string,
  employeeName: string,
  businessName: string,
  signingLink: string
): Promise<void> {
  const safeEmployee = escapeHtml(employeeName);
  const safeBusiness = escapeHtml(businessName);

  const html = renderEmail({
    heading: "You've been asked to act as a guarantor",
    preheader: `${employeeName} listed you as their guarantor`,
    body:
      para("Hello,") +
      para(`<strong>${safeEmployee}</strong> has listed you as their guarantor as part of their employment with <strong>${safeBusiness}</strong>. To complete this, please open the link below, fill in your details, and sign.`) +
      muted("This link is unique to you and can only be used once. Your submission cannot be edited after you sign."),
    button: { label: "Review &amp; sign", href: signingLink },
    showLinkFallback: true,
    signoff: `The ${safeBusiness} Team`,
  });

  await enqueueEmail({
    to,
    subject: `${sanitizeHeaderValue(employeeName)} has asked you to be their guarantor`,
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

  const html = renderEmail({
    heading: "Reset your password",
    preheader: `Your password reset code is ${code}`,
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para("Your one-time password reset code is:") +
      codeBlock(safeCode) +
      para("This code expires in 10 minutes. Do not share it with anyone.") +
      muted("If you did not request this, you can safely ignore this email. Your password will remain unchanged."),
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    heading: "Your password was changed",
    preheader: "If this wasn't you, secure your account now",
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para("Your password for Kowope was successfully changed.") +
      warn("If you did not make this change, contact your manager immediately or use Forgot password on the login screen to secure your account."),
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    tone: "danger",
    heading: "Your account email is being changed",
    preheader: `A request was made to change your email to ${newEmail}`,
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para(`A request was made to change the email address on your account to <strong>${safeNewEmail}</strong>.`) +
      para("This change only takes effect once the new address is verified. Until then, this email address remains your login.") +
      warn("If you did not request this, contact your manager immediately or change your password now to secure your account."),
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    tone: "warning",
    heading: copy.headline,
    preheader: copy.urgency,
    body: para(`Hi <strong>${safeName}</strong>,`) + para(copy.urgency),
    button: { label: "Subscribe now", href: billingLink },
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    tone: "warning",
    heading: copy.headline(safeFeature),
    preheader: copy.urgency(featureName, dateStr),
    body: para(`Hi <strong>${safeName}</strong>,`) + para(copy.urgency(safeFeature, dateStr)),
    button: { label: `Keep ${safeFeature}`, href: billingLink },
    signoff: "The Kowope Team",
  });

  sendEmail({
    to,
    subject: copy.subject(safeFeature),
    html,
  });
}

/** Tells a super admin that a release added features which stay hidden until they price and publish them. */
export function sendFeaturesAwaitingReviewEmail(to: string, name: string, features: { key: string; name: string }[]): void {
  const safeName = escapeHtml(name);
  const items = features.map((f) => `<li><strong>${escapeHtml(f.name)}</strong> <span style="color:#9ca3af">(${escapeHtml(f.key)})</span></li>`).join("");
  const count = features.length;
  const link = `${APP_URL}/super-admin/feature-catalog?active=pending`;
  const html = renderEmail({
    tone: "warning",
    heading: `${count} new feature${count === 1 ? "" : "s"} awaiting your review`,
    preheader: "Hidden from businesses until you set a price and publish",
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para(`A release added the following. ${count === 1 ? "It is" : "They are"} hidden from businesses until you set a price and publish ${count === 1 ? "it" : "them"}:`) +
      `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.7;color:#14202B;">${items}</ul>`,
    button: { label: "Review in Feature Catalog", href: link },
    signoff: ADMIN_CONSOLE_NAME,
  });
  sendEmail({ to, subject: `${count} new feature${count === 1 ? "" : "s"} awaiting review`, html });
}

export async function sendAccountLockedEmail(
  to: string,
  name: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeBusiness = escapeHtml(businessName);
  const unlockLink = `${APP_URL}/forgot-password`;

  const html = renderEmail({
    tone: "danger",
    heading: "Account locked",
    preheader: "Too many failed login attempts",
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para("Your account was locked after too many failed login attempts.") +
      para("It will automatically unlock after <strong>30 minutes</strong>.") +
      para("To unlock immediately, reset your password:"),
    button: { label: "Reset password", href: unlockLink },
    signoff: `The ${safeBusiness} Team`,
  });

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

  const html = renderEmail({
    heading: "Verify your email address",
    preheader: `Your verification code is ${code}`,
    body:
      para(`Hi <strong>${safeName}</strong>,`) +
      para("Your one-time email verification code is:") +
      codeBlock(safeCode) +
      para("This code expires in 10 minutes. Do not share it with anyone.") +
      muted("If you did not request this, you can safely ignore this email."),
    signoff: `The ${safeBusiness} Team`,
  });

  sendEmail({
    to,
    subject: `Your email verification code — ${sanitizeHeaderValue(businessName)}`,
    html,
  });
}


export interface PurchaseOrderEmailInput {
  to: string;
  businessName: string;
  vendorName: string;
  poNumber: string;
  supplierRef?: string | null;
  notes?: string | null;
  expectedDelivery?: Date | null;
  currency: string;
  lines: { name: string; quantity: number; unit?: string | null; unitCost: number }[];
  replyTo?: string;
}

/** Tells a supplier a purchase order has been placed. Throws only if queueing fails. */
export async function sendPurchaseOrderEmail(input: PurchaseOrderEmailInput): Promise<void> {
  const money = (n: number) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: input.currency }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };
  const total = input.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
  const rows = input.lines.map((l) => `
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E3E8EF;">${escapeHtml(l.name)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E3E8EF; text-align: right;">${l.quantity}${l.unit ? " " + escapeHtml(l.unit) : ""}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E3E8EF; text-align: right;">${escapeHtml(money(l.unitCost))}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E3E8EF; text-align: right;">${escapeHtml(money(l.quantity * l.unitCost))}</td>
    </tr>`).join("");
  const safeBusiness = escapeHtml(input.businessName);
  const arrival = input.expectedDelivery ? input.expectedDelivery.toDateString() : null;

  const html = renderEmail({
    width: 640,
    heading: `Purchase order ${escapeHtml(input.poNumber)}`,
    preheader: `${input.businessName} placed an order with you`,
    body:
      para(`Hello ${escapeHtml(input.vendorName)},`) +
      para(`<strong>${safeBusiness}</strong> has placed the order below with you.${input.supplierRef ? ` Your reference: <strong>${escapeHtml(input.supplierRef)}</strong>.` : ""}${arrival ? ` Expected arrival: <strong>${escapeHtml(arrival)}</strong>.` : ""}`) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:0 0 16px;">
        <thead>
          <tr style="background:#EEF4FC;text-align:left;color:#1A549F;">
            <th style="padding:8px;">Item</th>
            <th style="padding:8px;text-align:right;">Qty</th>
            <th style="padding:8px;text-align:right;">Unit cost</th>
            <th style="padding:8px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>` +
      (input.notes ? callout(`<strong>Note from ${safeBusiness}:</strong><br/>${escapeHtml(input.notes).replace(/\n/g, "<br/>")}`) : "") +
      `<p style="margin:0 0 16px;text-align:right;font-size:18px;font-weight:700;color:#14202B;">Order total: ${escapeHtml(money(total))}</p>` +
      muted(`Please quote ${escapeHtml(input.poNumber)} on your delivery note and invoice. Reply to this email if anything cannot be supplied as ordered.`),
    signoff: safeBusiness,
  });

  await enqueueEmail({
    to: input.to,
    subject: `Purchase order ${sanitizeHeaderValue(input.poNumber)} from ${sanitizeHeaderValue(input.businessName)}`,
    html,
    replyTo: input.replyTo,
  });
}

// ───────────── Partner network ─────────────

const formatMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const PARTNER_REMINDER_COPY = {
  upcoming: (partner: string, amount: string, due: string) => ({
    subject: `A balance with ${partner} is due soon`,
    heading: "A partner balance is due soon",
    line: `You owe ${partner} ${amount}, due on ${due}.`,
    tone: "brand" as const,
  }),
  due: (partner: string, amount: string, due: string) => ({
    subject: `A balance with ${partner} is due today`,
    heading: "A partner balance is due today",
    line: `You owe ${partner} ${amount}, due today (${due}).`,
    tone: "warning" as const,
  }),
  overdue: (partner: string, amount: string, due: string) => ({
    subject: `A balance with ${partner} is overdue`,
    heading: "A partner balance is overdue",
    line: `You owe ${partner} ${amount}, which was due on ${due}.`,
    tone: "danger" as const,
  }),
};

/** Nudges the owner of the business that owes a partner, for a balance from a stock transfer. */
export function sendPartnerReminderEmail(
  to: string,
  name: string | null,
  input: { kind: keyof typeof PARTNER_REMINDER_COPY; partnerName: string; amount: number; currency: string; dueDate: Date; transferId: string },
): void {
  const amount = formatMoney(input.amount, input.currency);
  const due = input.dueDate.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  // The subject is plain text and the body is HTML, so each gets the name in its own form.
  const copy = PARTNER_REMINDER_COPY[input.kind](escapeHtml(input.partnerName), amount, due);
  const subject = PARTNER_REMINDER_COPY[input.kind](input.partnerName, amount, due).subject;
  sendEmail({
    to,
    subject: sanitizeHeaderValue(subject),
    html: renderEmail({
      tone: copy.tone,
      heading: copy.heading,
      preheader: copy.line,
      body: para(`Hi <strong>${escapeHtml(name || "there")}</strong>,`) + para(copy.line) + muted("Record your payment on the transfer so your partner can confirm it."),
      button: { label: "Open the transfer", href: `${APP_URL}/partners/transfers/${encodeURIComponent(input.transferId)}` },
      signoff: `The ${escapeHtml(BUSINESS_NAME)} Team`,
    }),
  });
}

export interface PartnerStatementInput {
  businessName: string;
  periodLabel: string;
  currency: string;
  partners: { name: string; balance: number }[]; // positive: they owe the business
  transfersInPeriod: number;
  partnerCode: string;
}

/** The once-a-month summary of what each partner owes and is owed. Carries the invite code so it can be forwarded. */
export function sendPartnerStatementEmail(to: string, name: string | null, s: PartnerStatementInput): void {
  const rows = s.partners.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;font-size:15px;">${s.partners.map((p) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #E5E7EB;">${escapeHtml(p.name)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #E5E7EB;font-weight:600;">${
          p.balance > 0 ? `Owes you ${formatMoney(p.balance, s.currency)}` : p.balance < 0 ? `You owe ${formatMoney(-p.balance, s.currency)}` : "Even"}</td></tr>`).join("")}</table>`
    : "";
  sendEmail({
    to,
    subject: sanitizeHeaderValue(`Your partner statement for ${s.periodLabel}`),
    html: renderEmail({
      heading: `Partner statement: ${escapeHtml(s.periodLabel)}`,
      preheader: `${s.transfersInPeriod} transfer${s.transfersInPeriod === 1 ? "" : "s"} last month`,
      body:
        para(`Hi <strong>${escapeHtml(name || "there")}</strong>,`) +
        para(`Here is where <strong>${escapeHtml(s.businessName)}</strong> stands with its partners. There ${s.transfersInPeriod === 1 ? "was 1 transfer" : `were ${s.transfersInPeriod} transfers`} in ${escapeHtml(s.periodLabel)}.`) +
        rows +
        muted(`Know a business that should be sharing stock with you? Give them your partner code: <strong>${escapeHtml(s.partnerCode)}</strong>.`),
      button: { label: "Open the partner ledger", href: `${APP_URL}/partners/ledger` },
      signoff: `The ${escapeHtml(BUSINESS_NAME)} Team`,
      width: 560,
    }),
  });
}

/** An owner invites another business by email to become a partner. Sent at most once per address. */
export function sendPartnerInviteEmail(to: string, input: { fromBusiness: string; fromName: string | null; code: string; note: string | null }): void {
  const from = escapeHtml(input.fromBusiness);
  sendEmail({
    to,
    subject: sanitizeHeaderValue(`${input.fromBusiness} invites you to share stock`),
    html: renderEmail({
      heading: `${from} wants to be your partner`,
      preheader: "Share stock with each other and keep track of what is owed.",
      body:
        para(`${escapeHtml(input.fromName || input.fromBusiness)} invited you to connect on ${escapeHtml(BUSINESS_NAME)}, so your businesses can send each other stock and keep a clear record of what is owed, in money or in goods.`) +
        (input.note ? callout(escapeHtml(input.note)) : "") +
        para("Create your account, open <strong>Partners</strong>, and enter this code:") +
        codeBlock(escapeHtml(input.code)),
      button: { label: "Create your account", href: `${APP_URL}/auth/signup` },
      signoff: `The ${escapeHtml(BUSINESS_NAME)} Team`,
      afterButton: "If you already have an account, sign in and enter the code under Partners.",
    }),
  });
}
