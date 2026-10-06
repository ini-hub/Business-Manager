import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { authSessions } from "@shared/schema";
import { generateToken, type JWTPayload } from "../auth";

const SESSION_MS = 24 * 60 * 60 * 1000;
// Positive lookups are cached briefly so the auth middleware isn't a DB hit
// per request; revoking on this instance evicts immediately, other instances
// see it within the TTL.
const CACHE_TTL_MS = 15_000;
const activeCache = new Map<string, number>();

// Entries are otherwise only removed when re-checked after expiry; sweep the ones never seen again.
setInterval(() => {
  const now = Date.now();
  activeCache.forEach((until, sid) => { if (until <= now) activeCache.delete(sid); });
}, 60_000).unref();

// Lets long-lived connections (WebSocket) drop when their session is revoked
// without this module importing them.
const revokeListeners: Array<(sid: string) => void> = [];
export function onSessionRevoked(cb: (sid: string) => void): void {
  revokeListeners.push(cb);
}

export async function issueSession(req: Request, res: Response, payload: JWTPayload): Promise<string> {
  const [row] = await db
    .insert(authSessions)
    .values({
      userId: payload.userId,
      organisationId: payload.organisationId ?? null,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string | undefined)?.slice(0, 500) ?? null,
      expiresAt: new Date(Date.now() + SESSION_MS),
    })
    .returning({ id: authSessions.id });

  const token = generateToken({ ...payload, sid: row.id });
  res.cookie("jwt_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MS,
    sameSite: "lax",
  });
  return token;
}

export async function isSessionActive(sid: string): Promise<boolean> {
  const hit = activeCache.get(sid);
  if (hit && hit > Date.now()) return true;
  const [row] = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)));
  if (!row) {
    activeCache.delete(sid);
    return false;
  }
  activeCache.set(sid, Date.now() + CACHE_TTL_MS);
  return true;
}

export async function revokeSession(sid: string, reason = "logout"): Promise<void> {
  activeCache.delete(sid);
  await db
    .update(authSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)));
  revokeListeners.forEach((cb) => cb(sid));
}

/** Revokes every live session for a user (password change, "sign out everywhere"). */
export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  for (const r of rows) {
    activeCache.delete(r.id);
    revokeListeners.forEach((cb) => cb(r.id));
  }
}
