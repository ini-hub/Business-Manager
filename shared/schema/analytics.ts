import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb } from "drizzle-orm/pg-core";
import { businesses } from "./organisations";
import { users } from "./auth";

// ─── Analytics Explorer: saved views and dashboards ──────────────────────────
//
// Tenanted by businessId rather than storeId: a saved view routinely spans
// several stores (that is much of the point of it), so it cannot belong to one.
// This follows the stores / custom_roles / audit_logs precedent.

export const analyticsViews = pgTable("analytics_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  /**
   * A frozen AnalyticsViewSpec (query + presentation). Re-validated against the
   * zod schema on every write, and re-authorised against the READER on every
   * execution — never run as authored.
   */
  spec: jsonb("spec").notNull(),
  vizType: text("viz_type").notNull().default("line"),
  visibility: text("visibility").notNull().default("private"), // 'private' | 'business'
  /** Stores the view was authored against. Advisory only; access is re-checked on read. */
  storeIds: jsonb("store_ids").notNull().default(sql`'[]'::jsonb`),
  specVersion: integer("spec_version").notNull().default(1),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_analytics_views_business").on(table.businessId),
  index("idx_analytics_views_owner").on(table.ownerUserId),
  unique("analytics_views_owner_name_unique").on(table.ownerUserId, table.name),
]);

export const analyticsDashboards = pgTable("analytics_dashboards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  visibility: text("visibility").notNull().default("private"),
  isDefault: boolean("is_default").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_analytics_dashboards_business").on(table.businessId),
  unique("analytics_dashboards_owner_name_unique").on(table.ownerUserId, table.name),
]);

export const analyticsDashboardTiles = pgTable("analytics_dashboard_tiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dashboardId: varchar("dashboard_id").notNull()
    .references(() => analyticsDashboards.id, { onDelete: "cascade" }),
  /** Exactly one of viewId / spec is set; a CHECK constraint enforces it. */
  viewId: varchar("view_id").references(() => analyticsViews.id, { onDelete: "set null" }),
  spec: jsonb("spec"),
  titleOverride: text("title_override"),
  /** 12-column grid. */
  gridX: integer("grid_x").notNull().default(0),
  gridY: integer("grid_y").notNull().default(0),
  gridW: integer("grid_w").notNull().default(6),
  gridH: integer("grid_h").notNull().default(4),
  /** When false the tile follows the dashboard-level date range. */
  overridesDateRange: boolean("overrides_date_range").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_analytics_tiles_dashboard").on(table.dashboardId),
]);

export const analyticsViewsRelations = relations(analyticsViews, ({ one }) => ({
  business: one(businesses, { fields: [analyticsViews.businessId], references: [businesses.id] }),
  owner: one(users, { fields: [analyticsViews.ownerUserId], references: [users.id] }),
}));

export const analyticsDashboardsRelations = relations(analyticsDashboards, ({ one, many }) => ({
  business: one(businesses, { fields: [analyticsDashboards.businessId], references: [businesses.id] }),
  tiles: many(analyticsDashboardTiles),
}));

export const analyticsDashboardTilesRelations = relations(analyticsDashboardTiles, ({ one }) => ({
  dashboard: one(analyticsDashboards, {
    fields: [analyticsDashboardTiles.dashboardId],
    references: [analyticsDashboards.id],
  }),
  view: one(analyticsViews, {
    fields: [analyticsDashboardTiles.viewId],
    references: [analyticsViews.id],
  }),
}));

export type AnalyticsView = typeof analyticsViews.$inferSelect;
export type AnalyticsDashboard = typeof analyticsDashboards.$inferSelect;
export type AnalyticsDashboardTile = typeof analyticsDashboardTiles.$inferSelect;
