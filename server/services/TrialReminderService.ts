import { db } from "../db";
import { organisations, trialReminderLogs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendTrialReminderEmail } from "../email";
import { getOwnerContact } from "../lib/billing";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // every hour

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

type Stage = "3_days" | "2_days" | "today";

function stageFor(daysUntilEnd: number): Stage | null {
  if (daysUntilEnd === 3) return "3_days";
  if (daysUntilEnd === 2) return "2_days";
  if (daysUntilEnd === 0) return "today";
  return null;
}

async function wasAlreadySent(organisationId: string, stage: Stage): Promise<boolean> {
  const [log] = await db
    .select({ id: trialReminderLogs.id })
    .from(trialReminderLogs)
    .where(and(eq(trialReminderLogs.organisationId, organisationId), eq(trialReminderLogs.stage, stage)))
    .limit(1);
  return !!log;
}

async function runTrialReminders(): Promise<void> {
  const trialingOrgs = await db
    .select({ id: organisations.id, name: organisations.name, trialEndsAt: organisations.trialEndsAt })
    .from(organisations)
    .where(eq(organisations.status, "trialing"));

  const now = today();

  for (const org of trialingOrgs) {
    if (!org.trialEndsAt) continue;
    try {
      const end = new Date(org.trialEndsAt);
      end.setHours(0, 0, 0, 0);
      const daysUntilEnd = daysBetween(now, end);

      const stage = stageFor(daysUntilEnd);
      if (!stage) continue;
      if (await wasAlreadySent(org.id, stage)) continue;

      const owner = await getOwnerContact(org.id);
      if (!owner) continue;

      await sendTrialReminderEmail(owner.email, owner.name || "there", org.name, stage);

      // The unique (organisation_id, stage) index is the real dedupe guard
      // against a concurrent duplicate send; onConflictDoNothing just makes
      // the insert idempotent against it.
      await db.insert(trialReminderLogs).values({ organisationId: org.id, stage }).onConflictDoNothing();

      console.log(`[TrialReminder] Sent "${stage}" reminder to org ${org.id} (${org.name})`);
    } catch (err) {
      console.error(`[TrialReminder] Error processing org ${org.id}:`, err);
    }
  }
}

export function startTrialReminderService(): void {
  // Fire 10 s after startup to process any due reminders from the previous session
  setTimeout(() => runTrialReminders().catch(e => console.error("[TrialReminder]", e)), 10_000);
  setInterval(() => runTrialReminders().catch(e => console.error("[TrialReminder]", e)), POLL_INTERVAL_MS);
  console.log("[TrialReminder] Service started — polling every hour.");
}
