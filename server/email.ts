import nodemailer from "nodemailer";

// Parse Gmail credentials from environment or fall back to user-provided static credentials
const GMAIL_USER = (process.env.GMAIL_USER || "ebolujo101@gmail.com").trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "yfbr epll pzch cjcp")
  .replace(/\s/g, "");

const BUSINESS_NAME = process.env.BUSINESS_NAME || "Excellent Bolujo";
const APP_URL = process.env.APP_URL || "http://localhost:5001";

// Create nodemailer transport using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  try {
    await transporter.sendMail({
      from: `"${BUSINESS_NAME}" <${GMAIL_USER}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    console.log(`[Email Service] Successfully sent email to ${payload.to}`);
  } catch (error) {
    console.error(`[Email Service] Failed to send email to ${payload.to}:`, error);
  }
}

/**
 * 4.1 New Staff / Manager Activation Email
 */
export async function sendActivationEmail(
  to: string,
  name: string,
  businessName: string,
  role: string,
  code: string
): Promise<void> {
  const activationLink = `${APP_URL}/activate?code=${code}`;
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">You've been added to ${businessName}</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>You have been added to <strong>${businessName}</strong> as a <strong>${role}</strong>.</p>
      <p>Use the activation code below when you first log in:</p>
      <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0; color: #111827;">
        ${code}
      </div>
      <p>Or click the button below to go straight to the app to set up your password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${activationLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Activate My Account</a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">This link and code will expire in 48 hours. If you were not expecting this, you can safely ignore this email.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${businessName} Team</p>
    </div>
  `;

  await sendEmail({
    to,
    subject: `You've been added to ${businessName} — Activate your account`,
    html,
  });
}

/**
 * 4.2 Existing Platform User Added to New Organisation
 */
export async function sendAddedToOrgEmail(
  to: string,
  name: string,
  businessName: string,
  role: string,
  inviterName: string
): Promise<void> {
  const loginLink = `${APP_URL}/auth/login`;
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">You've been added to ${businessName}</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p><strong>${inviterName}</strong> has added you to <strong>${businessName}</strong> as a <strong>${role}</strong>.</p>
      <p>Log in with your existing credentials to accept and access this business workspace:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${loginLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Open Business Manager</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${businessName} Team</p>
    </div>
  `;

  await sendEmail({
    to,
    subject: `You've been added to ${businessName}`,
    html,
  });
}

/**
 * 4.3 OTP Email (Forgot Password)
 */
export async function sendOtpEmail(
  to: string,
  name: string,
  code: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #ef4444; margin-bottom: 20px;">Reset your password</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your one-time password reset code is:</p>
      <div style="background-color: #fef2f2; border: 1px solid #fee2e2; padding: 15px; text-align: center; border-radius: 6px; font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 20px 0; color: #b91c1c;">
        ${code}
      </div>
      <p>This code will expire in 10 minutes. Do not share this code with anyone.</p>
      <p style="color: #6b7280; font-size: 14px;">If you did not request this, you can safely ignore this email. Your password will remain unchanged.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${businessName} Team</p>
    </div>
  `;

  await sendEmail({
    to,
    subject: `Your password reset code — ${businessName}`,
    html,
  });
}

/**
 * 4.4 Password Changed Confirmation Email
 */
export async function sendPasswordChangedEmail(
  to: string,
  name: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #6a9ad9ff; margin-bottom: 20px;">Password Changed Successfully</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your password for Business Manager was successfully changed.</p>
      <p style="color: #dc2626; font-weight: bold;">If you did not make this change, contact your manager immediately or use Forgot Password on the login screen to secure your account.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${businessName} Team</p>
    </div>
  `;

  await sendEmail({
    to,
    subject: `Your password was changed — ${businessName}`,
    html,
  });
}

/**
 * 4.5 Account Locked Email
 */
export async function sendAccountLockedEmail(
  to: string,
  name: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const unlockLink = `${APP_URL}/forgot-password`;
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #b91c1c; margin-bottom: 20px;">Account Locked</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your account was locked after too many failed login attempts.</p>
      <p>It will automatically unlock after <strong>30 minutes</strong>.</p>
      <p>To unlock immediately, reset your password using the link below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${unlockLink}" style="background-color: #b91c1c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${businessName} Team</p>
    </div>
  `;

  await sendEmail({
    to,
    subject: `Your account has been locked — ${businessName}`,
    html,
  });
}

/**
 * 4.6 SMS Fallback Logger for Phone-Only Users
 */
export async function sendSMS(phone: string, textContent: string): Promise<void> {
  console.log(`[SMS Service] Outbound SMS to [${phone}]:\n"${textContent}"`);
}

/**
 * 4.7 OTP Email (Email Verification)
 */
export async function sendEmailVerificationOtpEmail(
  to: string,
  name: string,
  code: string,
  businessName: string = BUSINESS_NAME
): Promise<void> {
  const html = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">Verify your email address</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>Your one-time email verification code is:</p>
      <div style="background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 15px; text-align: center; border-radius: 6px; font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 20px 0; color: #4f46e5;">
        ${code}
      </div>
      <p>This code will expire in 10 minutes. Do not share this code with anyone.</p>
      <p style="color: #6b7280; font-size: 14px;">If you did not request this, you can safely ignore this email.</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">— The ${businessName} Team</p>
    </div>
  `;

  await sendEmail({
    to,
    subject: `Your email verification code — ${businessName}`,
    html,
  });
}

