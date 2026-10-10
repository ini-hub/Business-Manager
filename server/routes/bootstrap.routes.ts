import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { legalDocumentService } from "../services/LegalDocumentService";
import { auditLogger } from "../audit";
import { getClientIp } from "./helpers";
import { loadAuthUser, loadActiveBusiness, loadVisibleStores, loadEntitlementsPayload } from "../lib/shellData";
import type { RouteMiddlewares } from "./business.routes";

type Section<T> = { ok: true; data: T } | { ok: false };

/** One failed section must not fail the page: the client falls back to that section's own endpoint. */
async function section<T>(name: string, load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    console.error(`GET /api/bootstrap: ${name} failed:`, error);
    return { ok: false };
  }
}

export function registerBootstrapRoutes(app: Express, { isAuthenticated }: RouteMiddlewares): void {
  // Everything the app shell needs to paint, in one request. Each section is exactly what its own endpoint
  // returns (they share the loaders in server/lib/shellData.ts); the client seeds its query cache from this
  // and keeps using the individual endpoints for refreshes. Sits behind the normal organisation-lock gate
  // (it is deliberately NOT exempt like /api/business), so a locked org gets the same answer as before and
  // the client falls back to the exempt endpoints.
  app.get("/api/bootstrap", isAuthenticated, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Authentication required." });

    const [authUser, business, stores, entitlements, consent, organisations] = await Promise.all([
      section("user", async () => {
        const payload = await loadAuthUser(req);
        if (!payload) throw new Error("no user record");
        return payload;
      }),
      section("business", () => loadActiveBusiness(req)),
      section("stores", async () => {
        const result = await loadVisibleStores(req);
        if (!result.ok) throw new Error(result.error);
        return result.data;
      }),
      section("entitlements", async () => {
        if (!user.businessId) throw new Error("no business");
        return loadEntitlementsPayload(user);
      }),
      section("consent", async () => ({ hasAccepted: await legalDocumentService.hasAcceptedCurrentDocuments(user.userId ?? user.id) })),
      section("organisations", () => storage.getOrganisationsByUserId(user.userId ?? user.id)),
    ]);

    if (authUser.ok) auditLogger.logAuthAttempt(user.id, getClientIp(req), true);
    // Never cached by intermediaries: it is per-user and carries the viewer's masked data.
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ user: authUser, business, stores, entitlements, consent, organisations });
  });
}
