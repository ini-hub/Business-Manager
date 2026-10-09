import * as Sentry from "@sentry/node";

/** Error tracking is off unless SENTRY_DSN is set. No PII is attached automatically. */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0,
  });
}

export function captureServerError(err: unknown): void {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}
