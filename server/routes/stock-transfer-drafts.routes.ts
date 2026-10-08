import { parsePage } from "../lib/pagination";
import { pagedSelect, totalOf } from "../lib/pagedQuery";
import type { Express } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { stockTransferDrafts } from "@shared/schema";
import { getUserId } from "./helpers";
import type { RouteMiddlewares } from "./inventory.routes";

const draftBody = z.object({
  storeId: z.string().min(1),
  kind: z.enum(["send", "request"]),
  otherStoreId: z.string().optional().nullable(),
  formData: z.record(z.unknown()),
});

// Saved send/request stock forms. Nothing here touches stock_transfers or inventory.
export function registerStockTransferDraftRoutes(app: Express, { requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  app.get("/api/stock-transfer-drafts", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "storeId required" });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const page = parsePage(req.query);
      const where = eq(stockTransferDrafts.storeId, storeId);
      res.json(await pagedSelect(
        page,
        ({ limit, offset }) => db.select().from(stockTransferDrafts).where(where).orderBy(desc(stockTransferDrafts.updatedAt)).limit(limit).offset(offset),
        () => totalOf(db.select({ total: sql<number>`count(*)::int` }).from(stockTransferDrafts).where(where)),
      ));
    } catch {
      res.status(500).json({ error: "Could not load drafts." });
    }
  });

  app.get("/api/stock-transfer-drafts/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const [row] = await db.select().from(stockTransferDrafts).where(eq(stockTransferDrafts.id, req.params.id));
      if (!row) return res.status(404).json({ error: "Draft not found." });
      if (!(await checkStoreAccess(row.storeId, req, res))) return;
      res.json(row);
    } catch {
      res.status(500).json({ error: "Could not load this draft." });
    }
  });

  app.post("/api/stock-transfer-drafts", requireManagerOrOwner, async (req, res) => {
    try {
      const body = draftBody.parse(req.body);
      if (!(await checkStoreAccess(body.storeId, req, res))) return;
      const [row] = await db.insert(stockTransferDrafts).values({
        storeId: body.storeId,
        createdByUserId: getUserId(req),
        kind: body.kind,
        otherStoreId: body.otherStoreId || null,
        formData: body.formData,
      }).returning();
      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid draft." });
      res.status(500).json({ error: "We couldn't save this draft. Please try again." });
    }
  });

  app.put("/api/stock-transfer-drafts/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const body = draftBody.parse(req.body);
      const [existing] = await db.select().from(stockTransferDrafts).where(eq(stockTransferDrafts.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Draft not found." });
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;
      const [row] = await db.update(stockTransferDrafts).set({
        kind: body.kind,
        otherStoreId: body.otherStoreId || null,
        formData: body.formData,
        updatedAt: new Date(),
      }).where(and(eq(stockTransferDrafts.id, existing.id), eq(stockTransferDrafts.storeId, existing.storeId))).returning();
      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid draft." });
      res.status(500).json({ error: "We couldn't save this draft. Please try again." });
    }
  });

  app.delete("/api/stock-transfer-drafts/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const [existing] = await db.select().from(stockTransferDrafts).where(eq(stockTransferDrafts.id, req.params.id));
      if (!existing) return res.status(204).send();
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;
      await db.delete(stockTransferDrafts).where(eq(stockTransferDrafts.id, existing.id));
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Could not discard this draft." });
    }
  });
}
