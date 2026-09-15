import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireLegalConsentPendingToken, isAuthenticated } from "../auth";
import { legalDocumentService } from "../services/LegalDocumentService";
import { completeLoginForUser, completeStaffActivation } from "../lib/authFlow";
import { acceptLegalConsentSchema } from "@shared/schema";
import { getClientIp } from "./helpers";
import { z } from "zod";

function getUserAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "unknown";
}

/**
 * Public legal-document reads (unauthenticated - needed by /terms, /privacy,
 * /data-usage, /legal/:type for any section a super admin has added, and the
 * signup-page/login-flow consent screens before or without a full session)
 * plus the self-service consent-acceptance endpoint reached only via the
 * legal_consent_pending_token cookie minted by login / set-activated-password
 * in server/routes.ts when LegalDocumentService.hasAcceptedCurrentDocuments
 * finds the account hasn't accepted the current versions. Deliberately NOT
 * behind isAuthenticated - see requireLegalConsentPendingToken in
 * server/auth.ts for why this token can never become a normal session.
 *
 * documentType is never validated against a fixed list here - a super admin
 * can add new sections (LegalDocumentService.createDocument) beyond the
 * three seeded defaults, and these routes pick them up automatically since
 * they just ask the service/repository for whatever documents actually exist.
 */
export function registerLegalRoutes(app: Express): void {
  // Includes contentMarkdown for every document in one round trip - the
  // signup form and the login-flow consent screen both render a checkbox
  // per document off this single call rather than fetching each separately,
  // since the document count is no longer fixed at three.
  app.get("/api/legal", async (_req: Request, res: Response) => {
    try {
      const current = await legalDocumentService.listAllCurrent();
      res.json({
        documents: current.map(c => ({
          documentType: c.document.documentType,
          title: c.document.title,
          contentMarkdown: c.version.contentMarkdown,
          versionNumber: c.version.versionNumber,
          publishedAt: c.version.createdAt,
        })),
      });
    } catch (error) {
      console.error("List legal documents error:", error);
      res.status(500).json({ error: "Could not load legal documents. Please try again." });
    }
  });

  // Powers LegalConsentBanner (client/src/components/legal-consent-banner.tsx):
  // an already-logged-in session is never interrupted mid-request when a
  // document changes (hasAcceptedCurrentDocuments is only re-checked at
  // login/activation time), so this is what lets the app proactively notice
  // and surface a "please review" nudge without forcing a logout.
  app.get("/api/legal/consent-status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.userId;
      const hasAccepted = await legalDocumentService.hasAcceptedCurrentDocuments(userId);
      res.json({ hasAccepted });
    } catch (error) {
      console.error("Get legal consent status error:", error);
      res.status(500).json({ error: "Could not check consent status." });
    }
  });

  // The already-logged-in counterpart to /consent-pending/accept above -
  // same acceptedDocumentTypes exact-match validation
  // (LegalDocumentService.recordAcceptance), but records against the
  // current session's user/org directly instead of a pending-token claim,
  // and never touches the session (no cookie issued/cleared, no redirect) -
  // the caller is already fully authenticated.
  app.post("/api/legal/accept", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.userId;
      const organisationId = (req as any).user?.organisationId ?? null;
      const body = acceptLegalConsentSchema.parse(req.body);

      const outcome = await legalDocumentService.recordAcceptance({
        userId,
        organisationId,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        acceptedDocumentTypes: body.acceptedDocumentTypes,
      });
      if (outcome.kind === "stale") {
        return res.status(409).json({
          error: {
            message: "Our legal documents changed while this page was open. Please refresh and accept the current versions to continue.",
            code: "LEGAL_DOCUMENTS_STALE",
          },
        });
      }

      res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      }
      console.error("Accept legal consent (authenticated) error:", error);
      res.status(500).json({ error: "Could not record your acceptance. Please try again." });
    }
  });

  app.post("/api/legal/consent-pending/accept", requireLegalConsentPendingToken, async (req: Request, res: Response) => {
    try {
      const { userId, continueTo } = (req as any).legalConsentSession;
      const body = acceptLegalConsentSchema.parse(req.body);

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ error: "This session is no longer valid. Please log in again." });
      }

      // organisationId is left null here rather than resolved from the
      // user's membership(s): at this point in either flow (retroactive
      // login gate, or first-time staff activation) the org resolution is
      // about to happen anyway inside completeLoginForUser/
      // completeStaffActivation below, and legal_document_acceptances.
      // organisation_id is nullable precisely so acceptance-recording never
      // has to duplicate that resolution just to attach a label.
      const outcome = await legalDocumentService.recordAcceptance({
        userId: user.id,
        organisationId: null,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        acceptedDocumentTypes: body.acceptedDocumentTypes,
      });
      if (outcome.kind === "stale") {
        // A document was archived/reactivated/added while this screen was
        // open - refuse rather than record consent for something the user
        // never actually saw. No cookie is cleared, so retrying after a
        // refresh (which re-fetches GET /api/legal and re-renders the
        // correct checkboxes) works normally.
        return res.status(409).json({
          error: {
            message: "Our legal documents changed while this page was open. Please refresh and accept the current versions to continue.",
            code: "LEGAL_DOCUMENTS_STALE",
          },
        });
      }

      res.clearCookie("legal_consent_pending_token");

      if (continueTo === "staff_activation") {
        await completeStaffActivation(user, res);
      } else {
        await completeLoginForUser(user, req, res);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      }
      console.error("Accept legal consent error:", error);
      res.status(500).json({ error: "Could not record your acceptance. Please try again." });
    }
  });

  // Registered last, deliberately: /api/legal/:type is a catch-all for
  // anything under /api/legal/* that didn't match a more specific route
  // above (consent-status, accept, consent-pending/accept) - registering it
  // earlier would have swallowed all of those as documentType="consent-status"
  // etc. instead of ever reaching their real handlers.
  app.get("/api/legal/:type", async (req: Request, res: Response) => {
    const { type } = req.params;
    try {
      const current = await legalDocumentService.getCurrentDocument(type);
      if (!current) {
        return res.status(404).json({ error: "This document has not been published yet." });
      }
      res.json({
        documentType: type,
        title: current.document.title,
        contentMarkdown: current.version.contentMarkdown,
        versionNumber: current.version.versionNumber,
        publishedAt: current.version.createdAt,
      });
    } catch (error) {
      console.error("Get legal document error:", error);
      res.status(500).json({ error: "Could not load this document. Please try again." });
    }
  });
}
