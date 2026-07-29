/**
 * Saved views and dashboards for the Analytics Explorer.
 *
 * The rule that matters here is in `readableViews` / `canRead`: a stored spec is
 * NEVER executed as authored. Its store list and its owner-only measures are
 * re-authorised against whoever is reading it, so a manager opening an owner's
 * shared view cannot reach stores or cost data they could not otherwise see.
 * Sharing a view must not become a privilege-escalation route.
 */

import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../db";
import {
  analyticsDashboardTiles,
  analyticsDashboards,
  analyticsViews,
  type AnalyticsDashboard,
  type AnalyticsDashboardTile,
  type AnalyticsView,
} from "@shared/schema";

export interface ViewerContext {
  userId: string;
  businessId: string;
  role: string;
}

export class AnalyticsViewRepository {
  // ── Views ────────────────────────────────────────────────────────────────

  /** Own views, plus anything shared business-wide. */
  async listViews(viewer: ViewerContext): Promise<AnalyticsView[]> {
    return db
      .select()
      .from(analyticsViews)
      .where(
        and(
          eq(analyticsViews.businessId, viewer.businessId),
          eq(analyticsViews.isArchived, false),
          or(
            eq(analyticsViews.ownerUserId, viewer.userId),
            eq(analyticsViews.visibility, "business"),
          ),
        ),
      )
      .orderBy(desc(analyticsViews.updatedAt));
  }

  async getView(id: string, viewer: ViewerContext): Promise<AnalyticsView | null> {
    const [row] = await db.select().from(analyticsViews).where(eq(analyticsViews.id, id));
    if (!row) return null;
    if (row.businessId !== viewer.businessId) return null;
    if (row.ownerUserId !== viewer.userId && row.visibility !== "business") return null;
    return row;
  }

  async createView(
    viewer: ViewerContext,
    data: {
      name: string;
      description?: string | null;
      spec: unknown;
      vizType: string;
      visibility: string;
      storeIds: string[];
    },
  ): Promise<AnalyticsView> {
    const [row] = await db
      .insert(analyticsViews)
      .values({
        businessId: viewer.businessId,
        ownerUserId: viewer.userId,
        name: data.name,
        description: data.description ?? null,
        spec: data.spec,
        vizType: data.vizType,
        visibility: data.visibility,
        storeIds: data.storeIds,
      })
      .returning();
    return row;
  }

  async updateView(
    id: string,
    viewer: ViewerContext,
    data: Partial<{
      name: string;
      description: string | null;
      spec: unknown;
      vizType: string;
      visibility: string;
      storeIds: string[];
    }>,
  ): Promise<AnalyticsView | null> {
    // Write is owner-only: a shared view is readable by the business, not editable.
    const existing = await this.getView(id, viewer);
    if (!existing || existing.ownerUserId !== viewer.userId) return null;

    const [row] = await db
      .update(analyticsViews)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(analyticsViews.id, id))
      .returning();
    return row ?? null;
  }

  /** Soft delete, so a dashboard tile pointing at it degrades rather than 500s. */
  async archiveView(id: string, viewer: ViewerContext): Promise<boolean> {
    const existing = await this.getView(id, viewer);
    if (!existing) return false;
    // The business owner may remove anything in their business.
    if (existing.ownerUserId !== viewer.userId && viewer.role !== "owner") return false;

    await db
      .update(analyticsViews)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(analyticsViews.id, id));
    return true;
  }

  // ── Dashboards ───────────────────────────────────────────────────────────

  async listDashboards(viewer: ViewerContext): Promise<AnalyticsDashboard[]> {
    return db
      .select()
      .from(analyticsDashboards)
      .where(
        and(
          eq(analyticsDashboards.businessId, viewer.businessId),
          eq(analyticsDashboards.isArchived, false),
          or(
            eq(analyticsDashboards.ownerUserId, viewer.userId),
            eq(analyticsDashboards.visibility, "business"),
          ),
        ),
      )
      .orderBy(desc(analyticsDashboards.updatedAt));
  }

  async getDashboard(
    id: string,
    viewer: ViewerContext,
  ): Promise<{ dashboard: AnalyticsDashboard; tiles: AnalyticsDashboardTile[] } | null> {
    const [dashboard] = await db
      .select()
      .from(analyticsDashboards)
      .where(eq(analyticsDashboards.id, id));
    if (!dashboard) return null;
    if (dashboard.businessId !== viewer.businessId) return null;
    if (dashboard.ownerUserId !== viewer.userId && dashboard.visibility !== "business") {
      return null;
    }

    const tiles = await db
      .select()
      .from(analyticsDashboardTiles)
      .where(eq(analyticsDashboardTiles.dashboardId, id))
      .orderBy(analyticsDashboardTiles.gridY, analyticsDashboardTiles.gridX);

    return { dashboard, tiles };
  }

  async createDashboard(
    viewer: ViewerContext,
    data: { name: string; description?: string | null; visibility: string },
  ): Promise<AnalyticsDashboard> {
    const [row] = await db
      .insert(analyticsDashboards)
      .values({
        businessId: viewer.businessId,
        ownerUserId: viewer.userId,
        name: data.name,
        description: data.description ?? null,
        visibility: data.visibility,
      })
      .returning();
    return row;
  }

  async updateDashboard(
    id: string,
    viewer: ViewerContext,
    data: Partial<{ name: string; description: string | null; visibility: string }>,
  ): Promise<AnalyticsDashboard | null> {
    const existing = await this.getDashboard(id, viewer);
    if (!existing || existing.dashboard.ownerUserId !== viewer.userId) return null;

    const [row] = await db
      .update(analyticsDashboards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(analyticsDashboards.id, id))
      .returning();
    return row ?? null;
  }

  async archiveDashboard(id: string, viewer: ViewerContext): Promise<boolean> {
    const existing = await this.getDashboard(id, viewer);
    if (!existing) return false;
    if (existing.dashboard.ownerUserId !== viewer.userId && viewer.role !== "owner") {
      return false;
    }
    await db
      .update(analyticsDashboards)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(analyticsDashboards.id, id));
    return true;
  }

  // ── Tiles ────────────────────────────────────────────────────────────────

  async addTile(
    dashboardId: string,
    viewer: ViewerContext,
    data: {
      viewId?: string | null;
      spec?: unknown;
      titleOverride?: string | null;
      gridX?: number;
      gridY?: number;
      gridW?: number;
      gridH?: number;
    },
  ): Promise<AnalyticsDashboardTile | null> {
    const existing = await this.getDashboard(dashboardId, viewer);
    if (!existing || existing.dashboard.ownerUserId !== viewer.userId) return null;

    // Mirrors the CHECK constraint, so the failure is a clear null rather than a
    // database error surfacing as a 500.
    const hasView = Boolean(data.viewId);
    const hasSpec = data.spec !== undefined && data.spec !== null;
    if (hasView === hasSpec) return null;

    const [row] = await db
      .insert(analyticsDashboardTiles)
      .values({
        dashboardId,
        viewId: data.viewId ?? null,
        spec: hasSpec ? data.spec : null,
        titleOverride: data.titleOverride ?? null,
        gridX: data.gridX ?? 0,
        // Append to the bottom by default rather than landing on an existing tile.
        gridY: data.gridY ?? existing.tiles.length,
        gridW: data.gridW ?? 6,
        gridH: data.gridH ?? 4,
      })
      .returning();
    return row;
  }

  async updateTile(
    tileId: string,
    viewer: ViewerContext,
    data: Partial<{
      titleOverride: string | null;
      gridX: number;
      gridY: number;
      gridW: number;
      gridH: number;
      overridesDateRange: boolean;
    }>,
  ): Promise<AnalyticsDashboardTile | null> {
    const [tile] = await db
      .select()
      .from(analyticsDashboardTiles)
      .where(eq(analyticsDashboardTiles.id, tileId));
    if (!tile) return null;

    const parent = await this.getDashboard(tile.dashboardId, viewer);
    if (!parent || parent.dashboard.ownerUserId !== viewer.userId) return null;

    const [row] = await db
      .update(analyticsDashboardTiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(analyticsDashboardTiles.id, tileId))
      .returning();
    return row ?? null;
  }

  async deleteTile(tileId: string, viewer: ViewerContext): Promise<boolean> {
    const [tile] = await db
      .select()
      .from(analyticsDashboardTiles)
      .where(eq(analyticsDashboardTiles.id, tileId));
    if (!tile) return false;

    const parent = await this.getDashboard(tile.dashboardId, viewer);
    if (!parent || parent.dashboard.ownerUserId !== viewer.userId) return false;

    await db.delete(analyticsDashboardTiles).where(eq(analyticsDashboardTiles.id, tileId));
    return true;
  }
}

export const analyticsViewRepository = new AnalyticsViewRepository();
