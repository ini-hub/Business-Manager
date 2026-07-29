/**
 * Analytics Explorer — HTTP surface.
 *
 * Note on method choice: /query, /scatter and /correlate are POST but READ-ONLY.
 * They are POST because the query document is too large and deeply nested for a
 * query string, not because they mutate anything. Do not wire them into
 * auditLogger, broadcastChange, or a write-path rate limiter.
 *
 * CSRF: server/csrf.ts requires an x-csrf-token header on every non-GET. The
 * client attaches it globally (client/src/main.tsx), so these need no special
 * handling — but they do need it, which is why they are not exempt.
 */

import type { Express, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { ZodError } from "zod";
import { analyticsQuerySchema, type AnalyticsQuery } from "@shared/analytics/query";
import { catalogForRole, getMeasure } from "@shared/analytics/catalog";
import { runAnalyticsQuery } from "../analytics/execute";
import { runCorrelate, runScatter } from "../analytics/relationships";
import type { StatTransform } from "@shared/analytics/model";
import { AnalyticsCompileError } from "../analytics/compiler";
import { formatZodErrors, resolveAccessibleStoreIds } from "./helpers";
import type { RouteMiddlewares } from "./reports.routes";

/**
 * Tighter than the global apiLimiter: each of these can run several grouped
 * aggregations, so they are far more expensive than a normal read.
 */
const analyticsComputeLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Per-user when authenticated; otherwise fall back to the IP. The fallback must
  // go through ipKeyGenerator so IPv6 clients are bucketed by /56 subnet rather
  // than by a single address they can trivially rotate within.
  keyGenerator: (req) => {
    const userId = (req as any).user?.userId ?? (req as any).user?.id;
    return userId != null ? String(userId) : ipKeyGenerator(req.ip ?? "");
  },
  message: { error: "Too many analytics queries. Please wait a moment." },
});

export function registerAnalyticsRoutes(
  app: Express,
  { isAuthenticated, requireManagerOrOwner }: RouteMiddlewares,
): void {
  /**
   * The catalog, filtered to what this role may see. Owner-only measures (cost,
   * margin) are stripped for managers here AND independently re-checked in
   * /query, so a hand-crafted request cannot reach them.
   */
  app.get(
    "/api/analytics/model",
    isAuthenticated,
    requireManagerOrOwner,
    async (req: Request, res: Response) => {
      try {
        const role = (req as any).user?.role ?? "";
        const { storeIds } = await resolveAccessibleStoreIds(req);
        res.json({ ...catalogForRole(role), storeIds });
      } catch (error) {
        console.error("[analytics] model failed:", error);
        res.status(500).json({ error: "Could not load the analytics model." });
      }
    },
  );

  // Read-only despite being POST — see the file header.
  app.post(
    "/api/analytics/query",
    isAuthenticated,
    requireManagerOrOwner,
    analyticsComputeLimiter,
    async (req: Request, res: Response) => {
      try {
        const role = (req as any).user?.role ?? "";
        const warnings: string[] = [];

        // Authorise stores BEFORE validating, so the schema sees the real set.
        const requested = Array.isArray(req.body?.storeIds) ? req.body.storeIds : undefined;
        const { storeIds, dropped } = await resolveAccessibleStoreIds(req, requested);
        if (storeIds.length === 0) {
          return res
            .status(403)
            .json({ error: "You do not have access to any of the selected stores." });
        }
        if (dropped.length > 0) {
          warnings.push(
            `${dropped.length} store(s) were excluded because you do not have access to them.`,
          );
        }

        // Owner-only measures are stripped rather than 403'd, so a shared view
        // still renders the parts the reader is entitled to.
        const askedFor: string[] = Array.isArray(req.body?.measures) ? req.body.measures : [];
        const permitted = askedFor.filter((id) => {
          const measure = getMeasure(id);
          return !measure?.minRole || role === measure.minRole;
        });
        if (permitted.length < askedFor.length) {
          warnings.push(
            "Some measures were hidden because they are only available to the business owner.",
          );
        }
        if (permitted.length === 0) {
          return res.status(403).json({
            error: "None of the selected measures are available to your role.",
          });
        }

        const query = analyticsQuerySchema.parse({
          ...req.body,
          storeIds,
          measures: permitted,
        });

        const result = await runAnalyticsQuery(query);
        res.json({ ...result, warnings: [...warnings, ...result.warnings] });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodErrors(error.errors) });
        }
        if (error instanceof AnalyticsCompileError) {
          return res.status(400).json({ error: error.message, detail: error.detail });
        }
        // A statement timeout is the user asking for too much, not a server fault.
        const message = error instanceof Error ? error.message : String(error);
        if (/statement timeout|canceling statement/i.test(message)) {
          return res.status(400).json({
            error:
              "That query took too long. Try a shorter date range, a coarser grain, or fewer breakdowns.",
          });
        }
        console.error("[analytics] query failed:", error);
        res.status(500).json({ error: "Could not run that query." });
      }
    },
  );

  // Read-only despite being POST — see the file header.
  app.post(
    "/api/analytics/scatter",
    isAuthenticated,
    requireManagerOrOwner,
    analyticsComputeLimiter,
    async (req: Request, res: Response) => {
      try {
        const { query, warnings } = await prepareQuery(req, res);
        if (!query) return;

        const x = String(req.body?.x ?? "");
        const y = String(req.body?.y ?? "");
        const pointGrain =
          req.body?.pointGrain === "dimension_member" ? "dimension_member" : "time_bucket";
        const transform = normaliseTransform(req.body?.transform);

        const role = (req as any).user?.role ?? "";
        const measureX = getMeasure(x);
        const measureY = getMeasure(y);
        if (!measureX || !measureY) {
          return res.status(400).json({ error: "Choose two measures for the axes." });
        }
        // x/y bypass the `measures` role filter above, so they need their own
        // check — otherwise a manager can request an owner-only measure (cost,
        // margin) as an axis instead of via `measures` and get it back anyway.
        if (
          (measureX.minRole && role !== measureX.minRole) ||
          (measureY.minRole && role !== measureY.minRole)
        ) {
          return res.status(403).json({
            error: "One of the selected axes is only available to the business owner.",
          });
        }

        const result = await runScatter(query, {
          x,
          y,
          pointGrain,
          pointDimension: req.body?.pointDimension,
          transform,
        });
        res.json({ ...result, warnings: [...warnings, ...result.warnings] });
      } catch (error) {
        handleAnalyticsError(error, res, "scatter");
      }
    },
  );

  // Read-only despite being POST — see the file header.
  app.post(
    "/api/analytics/correlate",
    isAuthenticated,
    requireManagerOrOwner,
    analyticsComputeLimiter,
    async (req: Request, res: Response) => {
      try {
        const { query, warnings } = await prepareQuery(req, res);
        if (!query) return;

        const result = await runCorrelate(query, {
          measures: query.measures,
          // Percentage change by default: on raw levels almost any two growing
          // measures correlate near 1, which would make this a machine for
          // producing confident nonsense.
          transform: normaliseTransform(req.body?.transform ?? "pct_change"),
          maxLag: Math.min(30, Math.max(0, Number(req.body?.maxLag ?? 7))),
        });
        res.json({ ...result, warnings: [...warnings, ...result.warnings] });
      } catch (error) {
        handleAnalyticsError(error, res, "correlate");
      }
    },
  );
}

function normaliseTransform(value: unknown): StatTransform {
  return value === "none" || value === "difference" || value === "pct_change"
    ? value
    : "none";
}

/**
 * Shared authorisation + validation for the compute endpoints.
 *
 * Resolves store access and strips owner-only measures BEFORE zod sees the body,
 * so the schema validates the query that will actually run. Writes the response
 * itself and returns a null query when the caller must be refused.
 */
async function prepareQuery(
  req: Request,
  res: Response,
): Promise<{ query: AnalyticsQuery | null; warnings: string[] }> {
  const role = (req as any).user?.role ?? "";
  const warnings: string[] = [];

  const requested = Array.isArray(req.body?.storeIds) ? req.body.storeIds : undefined;
  const { storeIds, dropped } = await resolveAccessibleStoreIds(req, requested);
  if (storeIds.length === 0) {
    res.status(403).json({ error: "You do not have access to any of the selected stores." });
    return { query: null, warnings };
  }
  if (dropped.length > 0) {
    warnings.push(
      `${dropped.length} store(s) were excluded because you do not have access to them.`,
    );
  }

  const askedFor: string[] = Array.isArray(req.body?.measures) ? req.body.measures : [];
  const permitted = askedFor.filter((id) => {
    const measure = getMeasure(id);
    return !measure?.minRole || role === measure.minRole;
  });
  if (permitted.length < askedFor.length) {
    warnings.push(
      "Some measures were hidden because they are only available to the business owner.",
    );
  }
  if (permitted.length === 0) {
    res.status(403).json({ error: "None of the selected measures are available to your role." });
    return { query: null, warnings };
  }

  const query = analyticsQuerySchema.parse({
    ...req.body,
    storeIds,
    measures: permitted,
    // These endpoints impose their own breakdown, so ignore whatever was sent.
    dimensions: [],
  });

  return { query, warnings };
}

function handleAnalyticsError(error: unknown, res: Response, label: string): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: formatZodErrors(error.errors) });
    return;
  }
  if (error instanceof AnalyticsCompileError) {
    res.status(400).json({ error: error.message, detail: error.detail });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/statement timeout|canceling statement/i.test(message)) {
    res.status(400).json({
      error: "That query took too long. Try a shorter date range or a coarser grain.",
    });
    return;
  }
  console.error(`[analytics] ${label} failed:`, error);
  res.status(500).json({ error: `Could not run that ${label}.` });
}
