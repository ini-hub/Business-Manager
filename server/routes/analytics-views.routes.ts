/**
 * Saved views and dashboards — CRUD.
 *
 * The security rule this file enforces: a persisted spec is validated on write
 * and RE-AUTHORISED on read. `sanitiseSpecForViewer` strips stores the reader
 * cannot reach and measures their role cannot see, then reports what it removed.
 * It strips rather than 403s, so a shared view still renders the part the reader
 * is entitled to instead of becoming an opaque error.
 */

import type { Express, Request, Response } from "express";
import { ZodError, z } from "zod";
import { analyticsViewSpecSchema } from "@shared/analytics/query";
import { getMeasure } from "@shared/analytics/catalog";
import { analyticsViewRepository, type ViewerContext } from "../repositories/AnalyticsViewRepository";
import { formatZodErrors, resolveAccessibleStoreIds } from "./helpers";
import type { RouteMiddlewares } from "./reports.routes";

const viewBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  spec: analyticsViewSpecSchema,
  visibility: z.enum(["private", "business"]).default("private"),
});

const dashboardBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  visibility: z.enum(["private", "business"]).default("private"),
});

const tileBodySchema = z.object({
  viewId: z.string().min(1).nullish(),
  spec: analyticsViewSpecSchema.nullish(),
  titleOverride: z.string().max(120).nullish(),
  gridX: z.number().int().min(0).max(11).optional(),
  gridY: z.number().int().min(0).max(500).optional(),
  gridW: z.number().int().min(1).max(12).optional(),
  gridH: z.number().int().min(1).max(20).optional(),
});

function viewerFrom(req: Request): ViewerContext | null {
  const user = (req as any).user;
  if (!user?.businessId) return null;
  return {
    userId: user.userId ?? user.id,
    businessId: user.businessId,
    role: user.role ?? "",
  };
}

/**
 * Re-authorises a stored spec against the CURRENT reader.
 *
 * Never trust the persisted storeIds or measure list: they were authorised for
 * whoever saved the view, which may be someone with broader access.
 */
async function sanitiseSpecForViewer(
  req: Request,
  spec: any,
): Promise<{ spec: any; warnings: string[] }> {
  const warnings: string[] = [];
  const role = (req as any).user?.role ?? "";
  const query = spec?.query ?? {};

  const { storeIds, dropped } = await resolveAccessibleStoreIds(
    req,
    Array.isArray(query.storeIds) ? query.storeIds : undefined,
  );
  if (dropped.length > 0) {
    warnings.push(
      `${dropped.length} store(s) in this view are hidden because you do not have access to them.`,
    );
  }

  const measures: string[] = Array.isArray(query.measures) ? query.measures : [];
  const permitted = measures.filter((id) => {
    const measure = getMeasure(id);
    return measure && (!measure.minRole || role === measure.minRole);
  });
  if (permitted.length < measures.length) {
    warnings.push(
      "Some measures in this view are hidden because they are only available to the business owner.",
    );
  }

  return {
    spec: { ...spec, query: { ...query, storeIds, measures: permitted } },
    warnings,
  };
}

export function registerAnalyticsViewRoutes(
  app: Express,
  { isAuthenticated, requireManagerOrOwner }: RouteMiddlewares,
): void {
  const guard = [isAuthenticated, requireManagerOrOwner] as const;

  // ── Views ────────────────────────────────────────────────────────────────

  app.get("/api/analytics/views", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });
      res.json(await analyticsViewRepository.listViews(viewer));
    } catch (error) {
      console.error("[analytics] list views failed:", error);
      res.status(500).json({ error: "Could not load saved views." });
    }
  });

  app.get("/api/analytics/views/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const view = await analyticsViewRepository.getView(req.params.id, viewer);
      if (!view) return res.status(404).json({ error: "View not found." });

      const { spec, warnings } = await sanitiseSpecForViewer(req, view.spec);
      res.json({ ...view, spec, warnings });
    } catch (error) {
      console.error("[analytics] get view failed:", error);
      res.status(500).json({ error: "Could not load that view." });
    }
  });

  app.post("/api/analytics/views", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const body = viewBodySchema.parse(req.body);
      // Persist only stores the author can actually reach.
      const { storeIds } = await resolveAccessibleStoreIds(req, body.spec.query.storeIds);

      const view = await analyticsViewRepository.createView(viewer, {
        name: body.name,
        description: body.description,
        spec: { ...body.spec, query: { ...body.spec.query, storeIds } },
        vizType: body.spec.vizType,
        visibility: body.visibility,
        storeIds,
      });
      res.status(201).json(view);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      // The (owner, name) unique constraint.
      if (String((error as any)?.code) === "23505") {
        return res.status(409).json({ error: "You already have a view with that name." });
      }
      console.error("[analytics] create view failed:", error);
      res.status(500).json({ error: "Could not save that view." });
    }
  });

  app.patch("/api/analytics/views/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const body = viewBodySchema.partial().parse(req.body);
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.description !== undefined) patch.description = body.description ?? null;
      if (body.visibility !== undefined) patch.visibility = body.visibility;
      if (body.spec !== undefined) {
        const { storeIds } = await resolveAccessibleStoreIds(req, body.spec.query.storeIds);
        patch.spec = { ...body.spec, query: { ...body.spec.query, storeIds } };
        patch.vizType = body.spec.vizType;
        patch.storeIds = storeIds;
      }

      const updated = await analyticsViewRepository.updateView(req.params.id, viewer, patch);
      if (!updated) {
        return res.status(404).json({ error: "View not found, or it is not yours to edit." });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("[analytics] update view failed:", error);
      res.status(500).json({ error: "Could not update that view." });
    }
  });

  app.delete("/api/analytics/views/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const ok = await analyticsViewRepository.archiveView(req.params.id, viewer);
      if (!ok) {
        return res.status(404).json({ error: "View not found, or it is not yours to delete." });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[analytics] delete view failed:", error);
      res.status(500).json({ error: "Could not delete that view." });
    }
  });

  // ── Dashboards ───────────────────────────────────────────────────────────

  app.get("/api/analytics/dashboards", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });
      res.json(await analyticsViewRepository.listDashboards(viewer));
    } catch (error) {
      console.error("[analytics] list dashboards failed:", error);
      res.status(500).json({ error: "Could not load dashboards." });
    }
  });

  app.get("/api/analytics/dashboards/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const found = await analyticsViewRepository.getDashboard(req.params.id, viewer);
      if (!found) return res.status(404).json({ error: "Dashboard not found." });

      // Resolve each tile to a runnable, re-authorised spec.
      const warnings = new Set<string>();
      const tiles = await Promise.all(
        found.tiles.map(async (tile) => {
          let spec = tile.spec;
          let title = tile.titleOverride;

          if (tile.viewId) {
            const view = await analyticsViewRepository.getView(tile.viewId, viewer);
            if (!view) {
              // The view was deleted or unshared; the tile stays, visibly empty.
              return { ...tile, spec: null, resolvedTitle: title ?? "Unavailable view" };
            }
            spec = view.spec;
            title = title ?? view.name;
          }

          if (!spec) return { ...tile, spec: null, resolvedTitle: title ?? "Untitled" };

          const sanitised = await sanitiseSpecForViewer(req, spec);
          sanitised.warnings.forEach((w) => warnings.add(w));
          return { ...tile, spec: sanitised.spec, resolvedTitle: title ?? "Untitled" };
        }),
      );

      res.json({ ...found.dashboard, tiles, warnings: Array.from(warnings) });
    } catch (error) {
      console.error("[analytics] get dashboard failed:", error);
      res.status(500).json({ error: "Could not load that dashboard." });
    }
  });

  app.post("/api/analytics/dashboards", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const body = dashboardBodySchema.parse(req.body);
      res.status(201).json(await analyticsViewRepository.createDashboard(viewer, body));
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      if (String((error as any)?.code) === "23505") {
        return res.status(409).json({ error: "You already have a dashboard with that name." });
      }
      console.error("[analytics] create dashboard failed:", error);
      res.status(500).json({ error: "Could not create that dashboard." });
    }
  });

  app.patch("/api/analytics/dashboards/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const body = dashboardBodySchema.partial().parse(req.body);
      const updated = await analyticsViewRepository.updateDashboard(req.params.id, viewer, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      });
      if (!updated) {
        return res.status(404).json({ error: "Dashboard not found, or it is not yours to edit." });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("[analytics] update dashboard failed:", error);
      res.status(500).json({ error: "Could not update that dashboard." });
    }
  });

  app.delete("/api/analytics/dashboards/:id", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const ok = await analyticsViewRepository.archiveDashboard(req.params.id, viewer);
      if (!ok) {
        return res.status(404).json({ error: "Dashboard not found, or it is not yours to delete." });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[analytics] delete dashboard failed:", error);
      res.status(500).json({ error: "Could not delete that dashboard." });
    }
  });

  // ── Tiles ────────────────────────────────────────────────────────────────

  app.post(
    "/api/analytics/dashboards/:id/tiles",
    ...guard,
    async (req: Request, res: Response) => {
      try {
        const viewer = viewerFrom(req);
        if (!viewer) return res.status(403).json({ error: "No business context." });

        const body = tileBodySchema.parse(req.body);
        const tile = await analyticsViewRepository.addTile(req.params.id, viewer, body);
        if (!tile) {
          return res.status(400).json({
            error:
              "Could not add that tile. A tile needs exactly one of a saved view or an inline query, " +
              "and the dashboard must be yours.",
          });
        }
        res.status(201).json(tile);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodErrors(error.errors) });
        }
        console.error("[analytics] add tile failed:", error);
        res.status(500).json({ error: "Could not add that tile." });
      }
    },
  );

  app.patch("/api/analytics/tiles/:tileId", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const body = tileBodySchema
        .pick({ titleOverride: true, gridX: true, gridY: true, gridW: true, gridH: true })
        .partial()
        .parse(req.body);

      const tile = await analyticsViewRepository.updateTile(req.params.tileId, viewer, {
        ...(body.titleOverride !== undefined
          ? { titleOverride: body.titleOverride ?? null }
          : {}),
        ...(body.gridX !== undefined ? { gridX: body.gridX } : {}),
        ...(body.gridY !== undefined ? { gridY: body.gridY } : {}),
        ...(body.gridW !== undefined ? { gridW: body.gridW } : {}),
        ...(body.gridH !== undefined ? { gridH: body.gridH } : {}),
      });
      if (!tile) return res.status(404).json({ error: "Tile not found." });
      res.json(tile);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("[analytics] update tile failed:", error);
      res.status(500).json({ error: "Could not update that tile." });
    }
  });

  app.delete("/api/analytics/tiles/:tileId", ...guard, async (req: Request, res: Response) => {
    try {
      const viewer = viewerFrom(req);
      if (!viewer) return res.status(403).json({ error: "No business context." });

      const ok = await analyticsViewRepository.deleteTile(req.params.tileId, viewer);
      if (!ok) return res.status(404).json({ error: "Tile not found." });
      res.json({ success: true });
    } catch (error) {
      console.error("[analytics] delete tile failed:", error);
      res.status(500).json({ error: "Could not remove that tile." });
    }
  });
}
