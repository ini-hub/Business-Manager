import { escapeHtml } from "../sanitize";
import { getAppUrl } from "./appUrl";

// One layout for every transactional email, so they all carry the Kowope brand.
// Table-based with inline styles because mail clients ignore most CSS. The logo is a PNG served from
// /brand (clients block SVG), and the header sits on brand blue so the app-icon tile blends into it.

const INK = "#14202B";
const BLUE = "#216AC7";
const BLUE_STRONG = "#1A549F";
const MUTED = "#5B6672";
const LINE = "#E3E8EF";
const PAGE = "#F3F6FA";
const FONT = "'Instrument Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type EmailTone = "brand" | "danger" | "warning";

const TONES: Record<EmailTone, { accent: string; soft: string; border: string; text: string }> = {
  brand: { accent: BLUE, soft: "#EEF4FC", border: "#C9DBF5", text: BLUE_STRONG },
  danger: { accent: "#B91C1C", soft: "#FEF2F2", border: "#FECACA", text: "#B91C1C" },
  warning: { accent: "#B45309", soft: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
};

export interface EmailLayoutInput {
  heading: string;
  /** Pre-escaped HTML for the body. Build it with para(), muted(), callout() and codeBlock(). */
  body: string;
  tone?: EmailTone;
  /** Hidden text shown by mail clients next to the subject in the inbox list. */
  preheader?: string;
  button?: { label: string; href: string };
  /** Sign-off in the footer, e.g. "The Acme Team". Pre-escaped. */
  signoff?: string;
  /** Small print under the button, e.g. when a link expires. Pre-escaped. */
  afterButton?: string;
  /** Show the raw link under the button for clients that mangle buttons. */
  showLinkFallback?: boolean;
  /** Content width in px. Wider for emails that carry a table. */
  width?: number;
}

export const para = (html: string) =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${html}</p>`;

export const muted = (html: string) =>
  `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${MUTED};">${html}</p>`;

export const warn = (html: string, tone: EmailTone = "danger") =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;font-weight:600;color:${TONES[tone].text};">${html}</p>`;

export const callout = (html: string, tone: EmailTone = "brand") =>
  `<div style="margin:0 0 20px;padding:14px 16px;background:${TONES[tone].soft};border:1px solid ${TONES[tone].border};border-radius:10px;font-size:15px;line-height:1.6;color:${INK};">${html}</div>`;

/** Big one-time code. `value` must already be escaped. */
export const codeBlock = (value: string, tone: EmailTone = "brand") =>
  `<div style="margin:4px 0 20px;padding:18px 16px;text-align:center;background:${TONES[tone].soft};border:1px solid ${TONES[tone].border};border-radius:10px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:${TONES[tone].text};">${value}</div>`;

function button(label: string, href: string, tone: EmailTone): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;">
      <tr>
        <td align="center" bgcolor="${TONES[tone].accent}" style="border-radius:10px;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${label}</a>
        </td>
      </tr>
    </table>`;
}

export function renderEmail(input: EmailLayoutInput): string {
  const tone = input.tone ?? "brand";
  const appUrl = getAppUrl();
  const width = input.width ?? 600;
  const logo = `${appUrl}/brand/app-icon-64.png`;
  const fallback = input.button && input.showLinkFallback
    ? muted(`If the button doesn't work, copy and paste this link into your browser:<br/><span style="word-break:break-all;color:${BLUE};">${escapeHtml(input.button.href)}</span>`)
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${width}px;">
        <tr>
          <td bgcolor="${BLUE}" style="background:${BLUE};border-radius:14px 14px 0 0;padding:22px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <img src="${logo}" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;" />
                </td>
                <td style="vertical-align:middle;font-family:${FONT};font-size:26px;font-weight:700;letter-spacing:-0.03em;color:#FFFFFF;line-height:1;">kowope</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td height="4" bgcolor="${TONES[tone].accent}" style="height:4px;line-height:4px;font-size:0;background:${TONES[tone].accent};">&nbsp;</td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 28px 12px;font-family:${FONT};color:${INK};">
            <h1 style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.02em;color:${INK};">${input.heading}</h1>
            ${input.body}
            ${input.button ? button(input.button.label, input.button.href, tone) : ""}
            ${fallback}
            ${input.afterButton ?? ""}
          </td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:0 28px 28px;border-radius:0 0 14px 14px;font-family:${FONT};">
            <div style="border-top:1px solid ${LINE};padding-top:18px;font-size:13px;line-height:1.6;color:${MUTED};">
              ${input.signoff ? `<div style="font-weight:600;color:${INK};">${input.signoff}</div>` : ""}
              <div>Sent through <a href="${appUrl}" style="color:${BLUE};text-decoration:none;font-weight:600;">kowope</a> &middot; Run your business</div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
