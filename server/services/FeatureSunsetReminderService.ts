import { db } from "../db";
import { orgFeatureEntitlements, featureCatalog, featureSunsetReminderLogs, organisationMembers, users, notifications, announcements } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendFeatureSunsetReminderEmail } from "../email";

/**
 * The §2.7 sunset-notice mechanism from the pay-per-feature entitlement
 * plan: when the super admin schedules a currently-free feature to become
 * paid, every org using it gets an orgFeatureEntitlements row with
 * source='grandfathered_sunset' and status='pending_removal'. This service
 * finds those rows and sends the staged 30/7/1-day-and-today reminders,
 * directly mirroring server/services/TrialReminderService.ts - same "poll
 * hourly, dedupe via a unique (org, feature, stage) log row" shape, just
 * scoped to a feature instead of the whole org.
 *
 * The removal itself is enforced elsewhere (server/lib/entitlements.ts's
 * lazy sweep inside getOrgEntitlements) - this service only notifies, it
 * never flips status itself.
 */

const POLL_INTERVAL_MS = 60 * 60 * 1000; // every hour

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

type Stage = "30_days" | "7_days" | "1_day" | "today";

function stageFor(daysUntilEnd: number): Stage | null {
  if (daysUntilEnd === 30) return "30_days";
  if (daysUntilEnd === 7) return "7_days";
  if (daysUntilEnd === 1) return "1_day";
  if (daysUntilEnd === 0) return "today";
  return null;
}

const ANNOUNCEMENT_COPY: Record<Stage, (feature: string) => { title: string; message: string }> = {
  "30_days": (f) => ({ title: `${f} is moving to paid`, message: `${f} becomes a paid add-on in 30 days. Add it any time before then to keep editing it without a gap.` }),
  "7_days": (f) => ({ title: `${f}: 7 days left free`, message: `${f} becomes a paid add-on in 7 days. Add it from Billing to keep editing it.` }),
  "1_day": (f) => ({ title: `${f} goes paid tomorrow`, message: `Last day of free access to ${f}. Add it today to avoid any interruption.` }),
  "today": (f) => ({ title: `${f} is now a paid add-on`, message: `${f} has moved behind the paywall. What you've set up still works - add the feature to keep editing it.` }),
};

async function wasAlreadySent(organisationId: string, featureId: string, stage: Stage): Promise<boolean> {
  const [log] = await db
    .select({ id: featureSunsetReminderLogs.id })
    .from(featureSunsetReminderLogs)
    .where(and(eq(featureSunsetReminderLogs.organisationId, organisationId), eq(featureSunsetReminderLogs.featureId, featureId), eq(featureSunsetReminderLogs.stage, stage)))
    .limit(1);
  return !!log;
}

async function getOwner(organisationId: string): Promise<{ userId: string; name: string | null; email: string } | undefined> {
  const [row] = await db
    .select({ userId: organisationMembers.userId, name: users.name, email: users.email })
    .from(organisationMembers)
    .innerJoin(users, eq(organisationMembers.userId, users.id))
    .where(and(eq(organisationMembers.organisationId, organisationId), eq(organisationMembers.role, "owner")))
    .limit(1);
  return row?.email ? { userId: row.userId, name: row.name, email: row.email } : undefined;
}

async function runFeatureSunsetReminders(): Promise<void> {
  const pending = await db
    .select({
      organisationId: orgFeatureEntitlements.organisationId,
      featureId: orgFeatureEntitlements.featureId,
      removalEffectiveAt: orgFeatureEntitlements.removalEffectiveAt,
      featureName: featureCatalog.name,
    })
    .from(orgFeatureEntitlements)
    .innerJoin(featureCatalog, eq(orgFeatureEntitlements.featureId, featureCatalog.id))
    .where(and(eq(orgFeatureEntitlements.status, "pending_removal"), eq(orgFeatureEntitlements.source, "grandfathered_sunset")));

  const now = today();

  for (const row of pending) {
    if (!row.removalEffectiveAt) continue;
    try {
      const end = new Date(row.removalEffectiveAt);
      end.setHours(0, 0, 0, 0);
      const daysUntilEnd = daysBetween(now, end);

      const stage = stageFor(daysUntilEnd);
      if (!stage) continue;
      if (await wasAlreadySent(row.organisationId, row.featureId, stage)) continue;

      const owner = await getOwner(row.organisationId);
      if (!owner) continue;

      await sendFeatureSunsetReminderEmail(owner.email, owner.name || "there", row.featureName, row.removalEffectiveAt, stage);

      const copy = ANNOUNCEMENT_COPY[stage](row.featureName);

      await db.insert(notifications).values({
        userId: owner.userId,
        type: "system",
        message: copy.message,
      });

      await db.insert(announcements).values({
        title: copy.title,
        message: copy.message,
        type: "warning",
        target: "specific_org",
        targetOrgId: row.organisationId,
        showFrom: now,
        showUntil: row.removalEffectiveAt,
        dismissible: true,
        createdBy: "system",
      });

      // The unique (organisation_id, feature_id, stage) index is the real
      // dedupe guard against a concurrent duplicate send; onConflictDoNothing
      // just makes the insert idempotent against it.
      await db.insert(featureSunsetReminderLogs).values({ organisationId: row.organisationId, featureId: row.featureId, stage }).onConflictDoNothing();

      console.log(`[FeatureSunsetReminder] Sent "${stage}" reminder to org ${row.organisationId} for "${row.featureName}"`);
    } catch (err) {
      console.error(`[FeatureSunsetReminder] Error processing org ${row.organisationId} / feature ${row.featureId}:`, err);
    }
  }
}

export function startFeatureSunsetReminderService(): void {
  // Fire 20 s after startup (staggered after TrialReminderService's 10 s) to
  // process any due reminders from the previous session.
  setTimeout(() => runFeatureSunsetReminders().catch((e) => console.error("[FeatureSunsetReminder]", e)), 20_000);
  setInterval(() => runFeatureSunsetReminders().catch((e) => console.error("[FeatureSunsetReminder]", e)), POLL_INTERVAL_MS);
  console.log("[FeatureSunsetReminder] Service started — polling every hour.");
}
