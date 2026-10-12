import type { Express } from "express";
import { z } from "zod";
import { auditLogger } from "../audit";
import { exchangeRateService } from "../services/ExchangeRateService";
import { getRateFeed } from "../services/rateFeed";
import { getAuditContext } from "./helpers";
import { normaliseCurrency, roundRate, validateRateInput } from "@shared/exchange-rates";
import type { RouteMiddlewares } from "./staff.routes";

/**
 * Owner-entered exchange rates for a business (see ExchangeRateService). Owners and managers can read
 * them, because a manager running payroll is the one who hits "no rate set"; only the owner changes them.
 */
export function registerExchangeRateRoutes(app: Express, { requireRole, requireManagerOrOwner }: RouteMiddlewares): void {
  app.get("/api/exchange-rates", requireManagerOrOwner, async (req: any, res) => {
    try {
      const businessId = req.user?.businessId;
      if (!businessId) return res.status(400).json({ error: "Please select a business first." });
      const [rates, currencies] = await Promise.all([
        exchangeRateService.list(businessId),
        exchangeRateService.businessCurrencies(businessId),
      ]);
      const feed = getRateFeed();
      res.json({
        currencies,
        rates: rates.map((r) => ({
          id: r.id, from: r.fromCurrency, to: r.toCurrency, rate: Number(r.rate), effectiveFrom: r.effectiveFrom,
          source: r.source, note: r.note, updatedAt: r.updatedAt,
        })),
        feed: { provider: feed.name, available: feed.isConfigured() },
      });
    } catch (error) {
      console.error("Exchange rates list error:", error);
      res.status(500).json({ error: "We couldn't load exchange rates. Please try again." });
    }
  });

  // Sets (or replaces, for the same pair and date) a rate. `alsoInverse` also stores the reverse
  // direction as 1/rate: a convenience, written as its own explicit row that can be edited on its own.
  app.put("/api/exchange-rates", requireRole("owner"), async (req: any, res) => {
    try {
      const businessId = req.user?.businessId;
      if (!businessId) return res.status(400).json({ error: "Please select a business first." });
      const body = z.object({
        from: z.string(), to: z.string(), rate: z.number(), effectiveFrom: z.string(),
        note: z.string().max(200).nullish(),
        source: z.enum(["manual", "feed_accepted"]).optional(),
        alsoInverse: z.boolean().optional(),
      }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: "Enter the two currencies, the rate and the date it applies from." });
      const { from, to, rate, effectiveFrom, note, source, alsoInverse } = body.data;

      const problem = validateRateInput({ from, to, rate, effectiveFrom });
      if (problem) return res.status(400).json({ error: problem });

      const fromCode = normaliseCurrency(from)!;
      const toCode = normaliseCurrency(to)!;
      const allowed = await exchangeRateService.businessCurrencies(businessId);
      if (!allowed.includes(fromCode) || !allowed.includes(toCode)) {
        return res.status(400).json({ error: "Rates can only be set between currencies your stores use." });
      }

      const saved = await exchangeRateService.set({
        businessId, from: fromCode, to: toCode, rate, effectiveFrom, note, source, userId: req.user?.id,
      });
      const written = [saved];
      if (alsoInverse) {
        const inverse = roundRate(1 / rate);
        const inverseProblem = validateRateInput({ from: toCode, to: fromCode, rate: inverse, effectiveFrom });
        if (inverseProblem) return res.status(400).json({ error: `The reverse rate can't be stored: ${inverseProblem}` });
        written.push(await exchangeRateService.set({
          businessId, from: toCode, to: fromCode, rate: inverse, effectiveFrom, note, source, userId: req.user?.id,
        }));
      }

      const ctx = await getAuditContext(req, {});
      for (const r of written) {
        auditLogger.logEvent(ctx, "EXCHANGE_RATE_SET", "exchange_rate", r.id, "success", {
          newValues: { from: r.fromCurrency, to: r.toCurrency, rate: Number(r.rate), effectiveFrom: r.effectiveFrom, source: r.source },
          changedFields: ["rate"],
        });
      }
      res.json({ saved: written.map((r) => ({ id: r.id, from: r.fromCurrency, to: r.toCurrency, rate: Number(r.rate), effectiveFrom: r.effectiveFrom })) });
    } catch (error) {
      console.error("Exchange rate set error:", error);
      res.status(500).json({ error: "We couldn't save that rate. Please try again." });
    }
  });

  app.delete("/api/exchange-rates/:id", requireRole("owner"), async (req: any, res) => {
    try {
      const businessId = req.user?.businessId;
      if (!businessId) return res.status(400).json({ error: "Please select a business first." });
      const removed = await exchangeRateService.remove(businessId, req.params.id);
      if (!removed) return res.status(404).json({ error: "Rate not found." });
      const ctx = await getAuditContext(req, {});
      auditLogger.logEvent(ctx, "EXCHANGE_RATE_DELETE", "exchange_rate", removed.id, "success", {
        previousValues: { from: removed.fromCurrency, to: removed.toCurrency, rate: Number(removed.rate), effectiveFrom: removed.effectiveFrom },
        changedFields: ["rate"],
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Exchange rate delete error:", error);
      res.status(500).json({ error: "We couldn't remove that rate. Please try again." });
    }
  });

  // A suggestion only: accepting it is an ordinary PUT above with source "feed_accepted".
  app.get("/api/exchange-rates/suggestion", requireRole("owner"), async (req: any, res) => {
    try {
      const from = normaliseCurrency(req.query.from);
      const to = normaliseCurrency(req.query.to);
      const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
      if (!from || !to || from === to) return res.status(400).json({ error: "Choose two different currencies." });
      const feed = getRateFeed();
      if (!feed.isConfigured()) return res.json({ available: false, provider: feed.name });
      const suggestion = await feed.suggest(from, to, date);
      res.json(suggestion ? { available: true, ...suggestion } : { available: true, provider: feed.name, rate: null });
    } catch (error) {
      console.error("Exchange rate suggestion error:", error);
      res.json({ available: false });
    }
  });
}
