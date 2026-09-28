import type { Express, Request, Response } from "express";
import { getUserId } from "./helpers";
import { StaffRepository } from "../repositories/StaffRepository";
import { gamificationRepository } from "../repositories/GamificationRepository";
import { BADGE_DEFINITIONS, badgesForSubject } from "@shared/gamification/badges";
import type { GamificationSubjectType } from "@shared/schema";
import type { RouteMiddlewares } from "./sales.routes";

const staffRepo = new StaffRepository();

function isSubjectType(v: unknown): v is GamificationSubjectType {
  return v === "customer" || v === "staff" || v === "owner";
}

export function registerGamificationRoutes(app: Express, { isAuthenticated, checkStoreAccess }: RouteMiddlewares): void {
  // Badge catalogue (static definitions) - safe for any authenticated user to read.
  app.get("/api/gamification/badge-definitions", isAuthenticated, (req, res) => {
    res.json(BADGE_DEFINITIONS);
  });

  // Leaderboard for staff or customers within a store. Owner leaderboards
  // don't make sense (a store has one owner), so subjectType is restricted here.
  app.get("/api/gamification/leaderboard", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const storeId = req.query.storeId as string;
      const subjectType = req.query.subjectType as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (subjectType !== "customer" && subjectType !== "staff") {
        return res.status(400).json({ error: "subjectType must be 'customer' or 'staff'." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const entries = await gamificationRepository.getLeaderboard(storeId, subjectType, limit);
      res.json(entries);
    } catch (error) {
      console.error("Error loading gamification leaderboard:", error);
      res.status(500).json({ error: "Could not load leaderboard." });
    }
  });

  // A subject's own points/badges/streak. Any authenticated user may read
  // any subject within a store they have access to - gamification data is
  // not sensitive the way financials are, and staff/owners routinely need
  // to see a customer's or colleague's standing (e.g. at checkout).
  app.get("/api/gamification/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const storeId = req.query.storeId as string;
      const subjectType = req.query.subjectType as string;
      const subjectId = req.query.subjectId as string;
      if (!storeId || !subjectId || !isSubjectType(subjectType)) {
        return res.status(400).json({ error: "storeId, subjectType, and subjectId are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const [points, badges] = await Promise.all([
        gamificationRepository.getPointsTotal(storeId, subjectType, subjectId),
        gamificationRepository.getBadges(storeId, subjectType, subjectId),
      ]);

      let streak = null;
      if (subjectType === "customer") streak = await gamificationRepository.getStreak(storeId, "customer", subjectId, "visit_week");
      if (subjectType === "staff") streak = await gamificationRepository.getStreak(storeId, "staff", subjectId, "on_time_shift");

      res.json({ points, badges, streak, availableBadges: badgesForSubject(subjectType) });
    } catch (error) {
      console.error("Error loading gamification summary:", error);
      res.status(500).json({ error: "Could not load gamification summary." });
    }
  });

  // Convenience endpoint for the logged-in staff member's own dashboard widget.
  app.get("/api/gamification/me", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated." });
      const staffMember = await staffRepo.getStaffByUserId(userId, storeId);
      if (!staffMember) return res.json({ points: 0, badges: [], streak: null, availableBadges: badgesForSubject("staff") });

      const [points, badges, streak] = await Promise.all([
        gamificationRepository.getPointsTotal(storeId, "staff", staffMember.id),
        gamificationRepository.getBadges(storeId, "staff", staffMember.id),
        gamificationRepository.getStreak(storeId, "staff", staffMember.id, "on_time_shift"),
      ]);

      res.json({ points, badges, streak, availableBadges: badgesForSubject("staff") });
    } catch (error) {
      console.error("Error loading own gamification summary:", error);
      res.status(500).json({ error: "Could not load gamification summary." });
    }
  });

  // Business-level (owner) milestones for a store - recomputed on read since
  // they only fire a handful of times over a store's lifetime.
  app.get("/api/gamification/business", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      await gamificationRepository.evaluateOwnerBadges(storeId);
      const [points, badges] = await Promise.all([
        gamificationRepository.getPointsTotal(storeId, "owner", storeId),
        gamificationRepository.getBadges(storeId, "owner", storeId),
      ]);

      res.json({ points, badges, availableBadges: badgesForSubject("owner") });
    } catch (error) {
      console.error("Error loading business gamification summary:", error);
      res.status(500).json({ error: "Could not load business gamification summary." });
    }
  });
}
