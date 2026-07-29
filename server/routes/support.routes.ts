import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { supportThreads, supportThreadMessages } from "@shared/schema";
import { storage } from "../storage";
import { broadcastChange } from "./helpers";
import { sendSupportRequestEmail } from "../email";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

// Postgres unique_violation
const UNIQUE_VIOLATION = "23505";

/**
 * A persistent, per-user conversation with "Support" - used both from the
 * Paywall lockout screen and the general Help & Support page. Deliberately
 * exempt from enforceOrgAccess (see server/auth.ts ORG_LOCK_EXEMPT_PREFIXES)
 * so a locked-out org can still reach it.
 *
 * "Continue an existing chat if unresolved, else start a new one" is a
 * single server-side invariant, not something the client tracks: the caller
 * never sends a thread id, only a message. POST /api/support/messages finds
 * the caller's open thread (if any) and appends to it, or creates a new one.
 * A partial unique index (one open thread per user) makes this race-safe.
 */
export function registerSupportRoutes(app: Express, { isAuthenticated }: RouteMiddlewares): void {
  app.get("/api/support/thread", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(400).json({ error: "User context required." });

      const [openThread] = await db
        .select()
        .from(supportThreads)
        .where(and(eq(supportThreads.createdByUserId, user.id), eq(supportThreads.status, "open")))
        .limit(1);

      let thread = openThread;
      let isResolved = false;

      if (!thread) {
        const [lastResolved] = await db
          .select()
          .from(supportThreads)
          .where(eq(supportThreads.createdByUserId, user.id))
          .orderBy(desc(supportThreads.lastMessageAt))
          .limit(1);
        thread = lastResolved;
        isResolved = !!lastResolved;
      }

      if (!thread) {
        return res.json({ thread: null, messages: [], isResolved: false });
      }

      const messages = await db
        .select()
        .from(supportThreadMessages)
        .where(eq(supportThreadMessages.threadId, thread.id))
        .orderBy(supportThreadMessages.createdAt);

      if (!isResolved) {
        await db.update(supportThreads).set({ userLastReadAt: new Date() }).where(eq(supportThreads.id, thread.id));
      }

      res.json({ thread, messages, isResolved });
    } catch (error) {
      console.error("GET /api/support/thread error:", error);
      res.status(500).json({ error: "We couldn't load your conversation. Please try again." });
    }
  });

  app.get("/api/support/threads", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.id) return res.status(400).json({ error: "User context required." });

      const threads = await db
        .select()
        .from(supportThreads)
        .where(eq(supportThreads.createdByUserId, user.id))
        .orderBy(desc(supportThreads.lastMessageAt));

      res.json(threads);
    } catch (error) {
      console.error("GET /api/support/threads error:", error);
      res.status(500).json({ error: "We couldn't load your conversations. Please try again." });
    }
  });

  app.post("/api/support/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.businessId || !user?.id) return res.status(400).json({ error: "Business context required." });

      const body = (req.body?.message ?? "").toString().trim();
      if (!body || body.length > 2000) {
        return res.status(400).json({ error: "Please enter a message (up to 2000 characters)." });
      }

      const [openThread] = await db
        .select()
        .from(supportThreads)
        .where(and(eq(supportThreads.createdByUserId, user.id), eq(supportThreads.status, "open")))
        .limit(1);

      let thread = openThread;

      if (!thread) {
        const business = await storage.getBusinessById(user.businessId);
        const reason = business?.status === "suspended" ? (business.suspensionReason || "other")
          : business?.status === "trialing" ? "trial_expired"
          : "general";

        try {
          const [created] = await db
            .insert(supportThreads)
            .values({ organisationId: user.businessId, createdByUserId: user.id, reason })
            .returning();
          thread = created;
        } catch (err: any) {
          if (err?.code !== UNIQUE_VIOLATION) throw err;
          // Lost the race to a concurrent request - the open thread now exists, use it.
          const [existing] = await db
            .select()
            .from(supportThreads)
            .where(and(eq(supportThreads.createdByUserId, user.id), eq(supportThreads.status, "open")))
            .limit(1);
          thread = existing;
        }
      }

      if (!thread) {
        return res.status(500).json({ error: "We couldn't start your conversation. Please try again." });
      }

      const [message] = await db
        .insert(supportThreadMessages)
        .values({ threadId: thread.id, senderType: "user", senderUserId: user.id, body })
        .returning();

      await db
        .update(supportThreads)
        .set({ lastMessageAt: new Date(), lastMessageBySenderType: "user" })
        .where(eq(supportThreads.id, thread.id));

      broadcastChange(req, "support");

      res.status(201).json({ thread, message });
    } catch (error) {
      console.error("POST /api/support/messages error:", error);
      res.status(500).json({ error: "We couldn't send your message. Please try again." });
    }
  });

  app.post("/api/support/email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.businessId || !user?.email) return res.status(400).json({ error: "Business context required." });

      const message = (req.body?.message ?? "").toString().trim();
      const subject = (req.body?.subject ?? "").toString().trim();
      if (!message || message.length > 2000) {
        return res.status(400).json({ error: "Please enter a message (up to 2000 characters)." });
      }

      const [business, userRecord] = await Promise.all([
        storage.getBusinessById(user.businessId),
        storage.getUser(user.id),
      ]);
      sendSupportRequestEmail(userRecord?.name || user.email, user.email, business?.name || "Unknown business", message, subject);

      res.status(201).json({ success: true });
    } catch (error) {
      console.error("POST /api/support/email error:", error);
      res.status(500).json({ error: "We couldn't send your email. Please try again." });
    }
  });
}
