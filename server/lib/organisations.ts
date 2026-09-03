import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { organisations, supportThreads, isGenuineSuspensionReason } from "@shared/schema";
import { broadcastDataChange } from "../websocket";

/**
 * The single DB-update for "this organisation's suspension is lifted" -
 * shared by POST /admin/businesses/:id/reactivate and the support-thread
 * "Reactivate & Resolve" action (server/routes-admin.ts), so both entry
 * points into "unsuspended" behave identically and both broadcast the same
 * way. Broadcasting "business" is what lets an owner already sitting on the
 * Paywall screen (which queries /api/business) clear live - see the
 * "business" entry in client/src/hooks/useRealtimeSync.ts's RESOURCE_KEYS.
 */
export async function reactivateOrganisation(orgId: string, note: string | undefined) {
  const [org] = await db
    .update(organisations)
    .set({
      status: "active",
      suspensionReason: null,
      suspensionNote: note || "Reactivated by Operations",
      suspendedAt: null,
    })
    .where(eq(organisations.id, orgId))
    .returning();

  if (org) broadcastDataChange(orgId, "business");

  return org;
}

/**
 * Auto-resolves every still-open, genuine-suspension-reason support thread
 * for an organisation with outcome 'reactivated'. Called right after
 * reactivateOrganisation, from both the standalone reactivate endpoint and
 * the thread's own "Reactivate & Resolve" action - a single pass naturally
 * resolves whichever thread the admin acted on (if any) plus any sibling
 * open suspension thread for the same org (e.g. a second staff member's own
 * thread), so there's no separate "resolve my own thread" step to keep
 * idempotent with this sweep. Calling it again once threads are already
 * resolved is a no-op (the status = 'open' filter excludes them).
 */
export async function autoResolveSuspensionThreads(orgId: string, adminId: string): Promise<void> {
  const openThreads = await db
    .select()
    .from(supportThreads)
    .where(and(eq(supportThreads.organisationId, orgId), eq(supportThreads.status, "open")));

  const toResolve = openThreads.filter((t) => isGenuineSuspensionReason(t.reason));

  for (const t of toResolve) {
    await db
      .update(supportThreads)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolvedByAdminId: adminId,
        resolutionOutcome: "reactivated",
      })
      .where(eq(supportThreads.id, t.id));
    broadcastDataChange(orgId, "support");
  }
}
