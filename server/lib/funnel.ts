import { db } from "../db";
import { funnelEvents } from "@shared/schema";

/**
 * Write-only funnel instrumentation: signup -> onboarding -> checkout events,
 * per organisation. Nothing reads these yet except future drop-off analysis -
 * this exists so "where do trial users actually get stuck" becomes a real
 * query instead of a guess. Never throws - a logging failure must never break
 * the calling flow (signup, checkout, etc).
 */
export async function logFunnelEvent(
  organisationId: string,
  eventName: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(funnelEvents).values({ organisationId, eventName, metadata: metadata ?? null });
  } catch (error) {
    console.error(`[funnel] Failed to log "${eventName}" for org ${organisationId}:`, error);
  }
}
