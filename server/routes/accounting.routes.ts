import type { Express, Request, Response } from "express";
import { AccountingRepository } from "../repositories/AccountingRepository";
import { AccountingService } from "../services/AccountingService";
import { insertCapitalContributionSchema, insertAssetSchema, insertLiabilitySchema } from "@shared/schema";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

const accountingRepository = new AccountingRepository();
const accountingService = new AccountingService();

/**
 * Capital contributions/withdrawals, manually tracked assets & liabilities,
 * and the derived balance-sheet/true-profitability view built on top of
 * AccountingService. See shared/schema/accounting.ts for the "why derived,
 * not stored" note on retained earnings.
 */
export function registerAccountingRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  app.get("/api/accounting/balance-sheet", isAuthenticated, async (req: Request, res: Response) => {
    const storeId = req.query.storeId as string;
    if (!storeId) return res.status(400).json({ error: "Store ID is required." });
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const balanceSheet = await accountingService.getBalanceSheet(storeId);
      res.json(balanceSheet);
    } catch (error) {
      console.error("[Accounting] balance sheet error:", error);
      res.status(500).json({ error: "Failed to load balance sheet." });
    }
  });

  app.get("/api/accounting/capital", isAuthenticated, async (req: Request, res: Response) => {
    const storeId = req.query.storeId as string;
    if (!storeId) return res.status(400).json({ error: "Store ID is required." });
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      res.json(await accountingRepository.listCapitalContributions(storeId));
    } catch (error) {
      res.status(500).json({ error: "Failed to load capital contributions." });
    }
  });

  app.post("/api/accounting/capital", requireManagerOrOwner, async (req: Request, res: Response) => {
    const parsed = insertCapitalContributionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input." });
    if (!(await checkStoreAccess(parsed.data.storeId, req, res))) return;

    try {
      res.json(await accountingRepository.addCapitalContribution(parsed.data));
    } catch (error) {
      console.error("[Accounting] add capital contribution error:", error);
      res.status(500).json({ error: "Failed to record capital contribution." });
    }
  });

  app.get("/api/accounting/assets", isAuthenticated, async (req: Request, res: Response) => {
    const storeId = req.query.storeId as string;
    if (!storeId) return res.status(400).json({ error: "Store ID is required." });
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      res.json(await accountingRepository.listAssets(storeId));
    } catch (error) {
      res.status(500).json({ error: "Failed to load assets." });
    }
  });

  app.post("/api/accounting/assets", requireManagerOrOwner, async (req: Request, res: Response) => {
    const parsed = insertAssetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input." });
    if (!(await checkStoreAccess(parsed.data.storeId, req, res))) return;

    try {
      res.json(await accountingRepository.addAsset(parsed.data));
    } catch (error) {
      console.error("[Accounting] add asset error:", error);
      res.status(500).json({ error: "Failed to add asset." });
    }
  });

  app.put("/api/accounting/assets/:id", requireManagerOrOwner, async (req: Request, res: Response) => {
    try {
      const existing = await accountingRepository.getAsset(req.params.id);
      if (!existing) return res.status(404).json({ error: "Asset not found." });
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;

      const parsed = insertAssetSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input." });

      res.json(await accountingRepository.updateAsset(req.params.id, parsed.data));
    } catch (error) {
      console.error("[Accounting] update asset error:", error);
      res.status(500).json({ error: "Failed to update asset." });
    }
  });

  app.delete("/api/accounting/assets/:id", requireManagerOrOwner, async (req: Request, res: Response) => {
    try {
      const existing = await accountingRepository.getAsset(req.params.id);
      if (!existing) return res.status(404).json({ error: "Asset not found." });
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;

      await accountingRepository.deleteAsset(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("[Accounting] delete asset error:", error);
      res.status(500).json({ error: "Failed to delete asset." });
    }
  });

  app.get("/api/accounting/liabilities", isAuthenticated, async (req: Request, res: Response) => {
    const storeId = req.query.storeId as string;
    if (!storeId) return res.status(400).json({ error: "Store ID is required." });
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      res.json(await accountingRepository.listLiabilities(storeId));
    } catch (error) {
      res.status(500).json({ error: "Failed to load liabilities." });
    }
  });

  app.post("/api/accounting/liabilities", requireManagerOrOwner, async (req: Request, res: Response) => {
    const parsed = insertLiabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input." });
    if (!(await checkStoreAccess(parsed.data.storeId, req, res))) return;

    try {
      res.json(await accountingRepository.addLiability(parsed.data));
    } catch (error) {
      console.error("[Accounting] add liability error:", error);
      res.status(500).json({ error: "Failed to add liability." });
    }
  });

  app.put("/api/accounting/liabilities/:id", requireManagerOrOwner, async (req: Request, res: Response) => {
    try {
      const existing = await accountingRepository.getLiability(req.params.id);
      if (!existing) return res.status(404).json({ error: "Liability not found." });
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;

      const parsed = insertLiabilitySchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input." });

      res.json(await accountingRepository.updateLiability(req.params.id, parsed.data));
    } catch (error) {
      console.error("[Accounting] update liability error:", error);
      res.status(500).json({ error: "Failed to update liability." });
    }
  });

  app.delete("/api/accounting/liabilities/:id", requireManagerOrOwner, async (req: Request, res: Response) => {
    try {
      const existing = await accountingRepository.getLiability(req.params.id);
      if (!existing) return res.status(404).json({ error: "Liability not found." });
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;

      await accountingRepository.deleteLiability(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("[Accounting] delete liability error:", error);
      res.status(500).json({ error: "Failed to delete liability." });
    }
  });
}
