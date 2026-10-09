import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Check, Mail } from "lucide-react";
import { Spinner } from "@/components/ui/loader";

export type OtpIssue = "wrong" | "expired" | "locked" | "error";

const LENGTH = 6;
const RESEND_SECONDS = 45;
const TTL_MS = 10 * 60 * 1000; // matches OTP_TTL_MS on the server

const ISSUE_TEXT: Record<Exclude<OtpIssue, "error" | "wrong">, string> = {
  expired: "This code has expired. Request a new one below.",
  locked: "Too many tries. Request a new code to continue.",
};

/** Maps the API's machine-readable error code onto a UI state. */
export function otpIssueFromCode(code?: string): OtpIssue {
  if (code === "OTP_INVALID") return "wrong";
  if (code === "OTP_EXPIRED") return "expired";
  if (code === "OTP_LOCKED") return "locked";
  return "error";
}

function wrongText(attemptsLeft?: number) {
  if (attemptsLeft === undefined) return "That code is not right. Check it and try again.";
  return `That code is not right. ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.`;
}

interface Props {
  email: string;
  verifying: boolean;
  resending: boolean;
  issue: OtpIssue | null;
  issueMessage?: string;
  attemptsLeft?: number;
  verified: boolean;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onEdit: () => void;
  onExpired: () => void;
  onChangeEmail: () => void;
  onContinue: () => void;
  /** Label for the post-verification button; defaults to the dashboard wording. */
  continueLabel?: string;
  /** Show the trial terms + implicit-consent line under the button (new-owner signup only). */
  showTrialTerms?: boolean;
}

export function EmailOtpForm(p: Props) {
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = digits.join("");
  const locked = p.issue === "locked";
  const blocked = locked || p.issue === "expired";

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  // A code stops working 10 minutes after it was sent; a resend restarts the clock.
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [left, setLeft] = useState(TTL_MS / 1000);
  const onExpiredRef = useRef(p.onExpired);
  onExpiredRef.current = p.onExpired;
  useEffect(() => {
    const tick = () => {
      const secs = Math.max(0, Math.ceil((sentAt + TTL_MS - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) onExpiredRef.current();
      return secs;
    };
    if (tick() === 0) return;
    const id = window.setInterval(() => { if (tick() === 0) window.clearInterval(id); }, 1000);
    return () => window.clearInterval(id);
  }, [sentAt]);

  // Expired or locked codes are useless: clear the boxes so a fresh one is typed.
  useEffect(() => {
    if (blocked) setDigits(Array(LENGTH).fill(""));
  }, [blocked]);

  const focus = (i: number) => refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  const setAt = (i: number, value: string) => {
    if (p.issue) p.onEdit();
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => d.map((x, j) => (j === i ? "" : x)));
      return;
    }
    // Typing or an autofilled code: spread digits from this box onward.
    setDigits((d) => {
      const next = [...d];
      clean.slice(0, LENGTH - i).split("").forEach((ch, k) => { next[i + k] = ch; });
      return next;
    });
    focus(i + clean.length);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i]) { focus(i - 1); }
    else if (e.key === "ArrowLeft") focus(i - 1);
    else if (e.key === "ArrowRight") focus(i + 1);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setAt(0, e.clipboardData.getData("text"));
  };

  const resend = () => {
    setDigits(Array(LENGTH).fill(""));
    setCooldown(RESEND_SECONDS);
    setSentAt(Date.now());
    p.onResend();
    focus(0);
  };

  if (p.verified) {
    return (
      <div className="ks-otp ks-otp--done">
        <span className="ks-otp-icon ks-otp-icon--ok" aria-hidden="true"><Check size={22} /></span>
        <h1 className="ks-title">Email verified</h1>
        <p className="ks-sub">
          {p.showTrialTerms
            ? "Your 14-day free trial starts now, with full access to every feature and no card required. After it ends you move to our free tier and choose only the features you want to keep. Nothing is deleted or charged automatically."
            : "Your account is ready. Your 14-day Growth trial starts now."}
        </p>
        <button type="button" className="ks-otp-primary" onClick={p.onContinue} data-testid="button-go-dashboard">
          {p.continueLabel ?? "Go to my dashboard"}
        </button>
        {p.showTrialTerms && (
          <p className="ks-sub" data-testid="text-trial-consent-note">By continuing, you start your 14-day free trial.</p>
        )}
      </div>
    );
  }

  const message =
    p.issue === "error" ? p.issueMessage
    : p.issue === "wrong" ? wrongText(p.attemptsLeft)
    : p.issue ? ISSUE_TEXT[p.issue]
    : null;
  const canVerify = code.length === LENGTH && !blocked && !p.verifying;
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  const mm = clock(cooldown);
  const showExpiry = !blocked && left > 0;

  return (
    <form
      className="ks-otp"
      onSubmit={(e) => { e.preventDefault(); if (canVerify) p.onSubmit(code); }}
      noValidate
    >
      <span className="ks-otp-icon" aria-hidden="true"><Mail size={22} /></span>
      <h1 className="ks-title">Check your email</h1>
      <p className="ks-sub">
        We sent a 6-digit code to <strong>{p.email}</strong>{" "}
        <button type="button" className="ks-otp-chip" onClick={p.onChangeEmail} data-testid="button-change-email">Change email</button>
      </p>

      <fieldset className="ks-otp-field">
        <legend>Verification code</legend>
        <div className="ks-otp-boxes">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              className={`ks-otp-box${p.issue === "wrong" || p.issue === "error" ? " is-bad" : ""}`}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              pattern="[0-9]*"
              maxLength={LENGTH}
              value={d}
              disabled={locked || p.verifying}
              aria-label={`Digit ${i + 1} of ${LENGTH}`}
              aria-invalid={p.issue === "wrong" || p.issue === "error"}
              aria-describedby="ks-otp-note"
              autoFocus={i === 0}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={onPaste}
              onFocus={(e) => e.target.select()}
              data-testid={`input-otp-${i}`}
            />
          ))}
        </div>
        <p id="ks-otp-note" className={`ks-otp-note${p.issue ? ` is-${p.issue}` : ""}`} role={p.issue ? "alert" : undefined}>
          {message ?? "Enter the code from the email."}
        </p>
        {showExpiry && (
          <p className={`ks-otp-expiry${left <= 60 ? " is-soon" : ""}`}>
            Code expires in <span role="timer" aria-live="off">{clock(left)}</span>
          </p>
        )}
      </fieldset>

      <button type="submit" className="ks-otp-primary" disabled={!canVerify} data-testid="button-verify-otp">
        {p.verifying ? (<><Spinner className="animate-spin" size={18} aria-hidden="true" />Verifying...</>) : "Verify email"}
      </button>

      <p className="ks-otp-resend">
        Did not get it?{" "}
        {cooldown > 0 && !blocked ? (
          <span>Resend code in {mm}</span>
        ) : (
          <button type="button" onClick={resend} disabled={p.resending} data-testid="button-resend-otp">
            {p.resending ? "Sending..." : "Resend code"}
          </button>
        )}
      </p>
      <p className="ks-otp-resend">Check your spam or promotions folder too.</p>
    </form>
  );
}

interface ChangeEmailProps {
  currentEmail: string;
  busy: boolean;
  error: string | null;
  onSubmit: (newEmail: string, password: string) => void;
  onCancel: () => void;
}

/** Fix a mistyped email before verifying. The password stands in for a session. */
export function ChangeEmailForm({ currentEmail, busy, error, onSubmit, onCancel }: ChangeEmailProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const ready = /^\S+@\S+\.\S+$/.test(email.trim()) && password.length > 0 && !busy;
  return (
    <form
      className="ks-otp"
      onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(email.trim(), password); }}
      noValidate
    >
      <span className="ks-otp-icon" aria-hidden="true"><Mail size={22} /></span>
      <h1 className="ks-title">Change your email</h1>
      <p className="ks-sub">We will send a new code to the address you enter. Current email: <strong>{currentEmail}</strong></p>
      <div className="ks-otp-fields">
        <div>
          <label htmlFor="ks-new-email">New email</label>
          <input id="ks-new-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-new-email" />
        </div>
        <div>
          <label htmlFor="ks-confirm-password">Your password</label>
          <input id="ks-confirm-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-confirm-password" />
          <p className="ks-otp-note">The one you just created. It confirms this is your account.</p>
        </div>
      </div>
      {error && <p className="ks-otp-note is-wrong" role="alert">{error}</p>}
      <button type="submit" className="ks-otp-primary" disabled={!ready} data-testid="button-save-email">
        {busy ? (<><Spinner className="animate-spin" size={18} aria-hidden="true" />Sending code...</>) : "Send new code"}
      </button>
      <p className="ks-otp-resend">
        <button type="button" onClick={onCancel} data-testid="button-cancel-change-email">Keep current email</button>
      </p>
    </form>
  );
}
