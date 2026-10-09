// Mono (open banking) client. Platform-level keys: stores link their own bank through the platform's Mono app.
// MONO_SECRET_KEY, MONO_PUBLIC_KEY and MONO_WEBHOOK_SECRET come from the environment.
import crypto from "crypto";

const MONO_BASE_URL = "https://api.withmono.com";
// Verified in Mono's docs: POST /v2/accounts/auth. The transactions path below is NOT yet confirmed
// against the docs or the sandbox; keep it in one place so it is a one-line fix.
const EXCHANGE_PATH = "/v2/accounts/auth";
const transactionsPath = (accountId: string) => `/v2/accounts/${encodeURIComponent(accountId)}/transactions`;

export const isMonoConfigured = () => !!(process.env.MONO_SECRET_KEY && process.env.MONO_PUBLIC_KEY);
export const getMonoPublicKey = () => process.env.MONO_PUBLIC_KEY ?? null;

async function monoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.MONO_SECRET_KEY;
  if (!key) throw new Error("Mono isn't configured - set MONO_SECRET_KEY and MONO_PUBLIC_KEY.");
  const response = await fetch(`${MONO_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", "mono-sec-key": key, ...init.headers },
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || `Mono request to ${path} failed (${response.status}).`);
  return body;
}

/** Swaps the one-time code from the Connect widget for the id that identifies the linked account. */
export async function exchangeCode(code: string): Promise<string> {
  const body = await monoRequest<any>(EXCHANGE_PATH, { method: "POST", body: JSON.stringify({ code }) });
  const id = body?.data?.id ?? body?.id;
  if (!id || typeof id !== "string") throw new Error("Mono didn't return an account id.");
  return id;
}

export type MonoTransaction = { externalId: string; direction: "credit" | "debit"; amount: number; narration: string | null; postedAt: Date };

/** One page of transactions. Mono amounts are in kobo; they are converted to naira here. */
export async function fetchTransactions(accountId: string, opts: { start?: Date; page?: number } = {}): Promise<{ items: MonoTransaction[]; hasNext: boolean }> {
  const params = new URLSearchParams({ paginate: "true", limit: "100", page: String(opts.page ?? 1) });
  if (opts.start) {
    params.set("start", opts.start.toISOString().slice(0, 10));
    params.set("end", new Date().toISOString().slice(0, 10));
  }
  const body = await monoRequest<any>(`${transactionsPath(accountId)}?${params.toString()}`, { method: "GET" });
  const rows: any[] = body?.data ?? [];
  const items = rows
    .filter((r) => r?.id && (r.type === "credit" || r.type === "debit") && Number.isFinite(Number(r.amount)) && r.date)
    .map((r): MonoTransaction => ({
      externalId: String(r.id),
      direction: r.type,
      amount: Math.round(Number(r.amount)) / 100,
      narration: typeof r.narration === "string" ? r.narration : null,
      postedAt: new Date(r.date),
    }));
  return { items, hasNext: !!body?.meta?.next };
}

/** Mono's webhook auth is a shared-secret header, compared in constant time. */
export function isValidMonoWebhook(header: string | undefined): boolean {
  const secret = process.env.MONO_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
