import type { ReactNode } from "react";
import { Link } from "wouter";
import { Check, Shield } from "lucide-react";
import { KowopeLogo } from "@/components/kowope-logo";
import "@/pages/landing.css";
import "./auth-shell.css";

const VARIANTS = {
  signup: {
    headline: "Set up your business in 10 minutes.",
    sub: "Free forever plan, with a 14-day Growth trial. No card needed.",
    link: { href: "/auth/login", label: "Log in" },
  },
  login: {
    headline: "Good to see you again.",
    sub: "Pick up where you left off: today's sales, stock and bookings are waiting.",
    link: { href: "/auth/signup", label: "Sign up" },
  },
  recovery: {
    headline: "Locked out? Let\u2019s get you back in.",
    sub: "Reset your password in a minute. Your sales, stock and customers are exactly where you left them.",
    link: { href: "/auth/login", label: "Log in" },
  },
} as const;

const RECOVERY_STEPS = ["Get a code", "Enter the code", "Set a new password"];

const POINTS = [
  "Record sales online or offline",
  "Track stock, customers and credit",
  "Set up for your kind of business",
  "Your data is never deleted",
];

/**
 * Shared frame for the login and sign-up screens: dark brand panel beside the
 * form from 1024px, a header bar with the opposite action below that. Always
 * light, like the landing page.
 */
export function AuthShell({ variant, step, children }: {
  variant: keyof typeof VARIANTS;
  /** Recovery only: 1-3 is the current step, 4 means all three are done. */
  step?: number;
  children: ReactNode;
}) {
  const v = VARIANTS[variant];
  return (
    <div className="kp ks force-light">
      <aside className="ks-side">
        <Link href="/" className="ks-side-logo" aria-label="Kowope home"><KowopeLogo /></Link>
        <div>
          <h2>{v.headline}</h2>
          <p className="ks-side-sub">{v.sub}</p>
          {variant === "recovery" ? (
            <ol className="ks-steps" aria-label="Progress">
              {RECOVERY_STEPS.map((label, i) => {
                const n = i + 1;
                const state = (step ?? 1) > n ? "done" : (step ?? 1) === n ? "current" : "todo";
                return (
                  <li key={label} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                    <span className="ks-step-dot" aria-hidden="true">{state === "done" ? <Check size={16} /> : n}</span>
                    {label}
                  </li>
                );
              })}
            </ol>
          ) : (
            <ul className="ks-points">
              {POINTS.map((p) => <li key={p}><Check size={16} aria-hidden="true" />{p}</li>)}
            </ul>
          )}
        </div>
        {variant === "recovery" && (
          <p className="ks-safety">
            <Shield size={20} aria-hidden="true" />
            Kowope will never ask for your reset code by call, SMS or WhatsApp. Don{"\u2019"}t share it with anyone, including staff.
          </p>
        )}
      </aside>
      <div className="ks-main">
        <header className="ks-top">
          <Link href="/" aria-label="Kowope home"><KowopeLogo /></Link>
          <Link href={v.link.href} className="ks-top-link">{v.link.label}</Link>
        </header>
        <div className="ks-center">
          <main className="ks-body">{children}</main>
        </div>
        <footer className="ks-legal">
          <nav aria-label="Legal">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/data-usage">Data Usage Policy</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
