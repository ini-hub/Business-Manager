import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { featureCatalog, superAdmins } from "@shared/schema";
import { sendFeaturesAwaitingReviewEmail } from "../email";

/** Features the registry sync created that no admin has published yet. */
export async function listPendingReview(): Promise<{ key: string; name: string }[]> {
  return db
    .select({ key: featureCatalog.key, name: featureCatalog.name })
    .from(featureCatalog)
    .where(eq(featureCatalog.reviewStatus, "pending_review"))
    .orderBy(featureCatalog.sortOrder);
}

/**
 * Emails every active super admin about features a sync just added. Called once per sync that created
 * something (the sync is idempotent, so a later boot with nothing new sends nothing). Returns how many were emailed.
 */
export async function notifyFeaturesAwaitingReview(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const features = await db
    .select({ key: featureCatalog.key, name: featureCatalog.name })
    .from(featureCatalog)
    .where(and(inArray(featureCatalog.key, keys), eq(featureCatalog.reviewStatus, "pending_review")))
    .orderBy(featureCatalog.sortOrder);
  if (features.length === 0) return 0;
  const admins = await db
    .select({ email: superAdmins.email, name: superAdmins.name })
    .from(superAdmins)
    .where(and(eq(superAdmins.role, "super_admin"), eq(superAdmins.status, "active")));
  for (const a of admins) sendFeaturesAwaitingReviewEmail(a.email, a.name, features);
  return admins.length;
}
