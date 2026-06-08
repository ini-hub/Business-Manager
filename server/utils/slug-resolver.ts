import { db } from "../db";
import {
  inventory,
  customers,
  vendors,
  vendorBills,
  expenses,
  products,
} from "@shared/schema";
import { sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a URL param that is either a full UUID or a human-readable slug
 * in the form "{name-slug}-{8-hex-chars}" back to the full UUID.
 *
 * The 8-char hex suffix is the first segment of the original UUID, so we
 * look up with: WHERE SUBSTRING(id, 1, 8) = '{prefix}'
 */
async function resolveParam(
  param: string,
  table: { id: any } & any
): Promise<string | null> {
  if (UUID_REGEX.test(param)) return param;

  // Extract the trailing 8-char hex prefix (last dash-delimited segment)
  const match = param.match(/-([0-9a-f]{8})$/i);
  if (!match) return null;

  const prefix = match[1].toLowerCase();
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(sql`SUBSTRING(${table.id}::text, 1, 8) = ${prefix}`)
    .limit(1);

  return row?.id ?? null;
}

// ── Per-entity resolvers ────────────────────────────────────────────────────

export const resolveInventoryId = (p: string) => resolveParam(p, inventory);
export const resolveCustomerId = (p: string) => resolveParam(p, customers);
export const resolveVendorId = (p: string) => resolveParam(p, vendors);
export const resolveVendorBillId = (p: string) => resolveParam(p, vendorBills);
export const resolveExpenseId = (p: string) => resolveParam(p, expenses);
export const resolveProductId = (p: string) => resolveParam(p, products);


// ── Express middleware factory ──────────────────────────────────────────────

function makeSlugMiddleware(
  resolver: (p: string) => Promise<string | null>,
  paramName = "id"
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.params[paramName];
      if (!raw) return next();
      const resolved = await resolver(raw);
      if (!resolved) return res.status(404).json({ error: "Not found." });
      req.params[paramName] = resolved;
      next();
    } catch {
      res.status(500).json({ error: "Failed to resolve identifier." });
    }
  };
}

export const withInventoryId = makeSlugMiddleware(resolveInventoryId);
export const withCustomerId = makeSlugMiddleware(resolveCustomerId);
export const withVendorId = makeSlugMiddleware(resolveVendorId);
export const withVendorBillId = makeSlugMiddleware(resolveVendorBillId, "billId");
export const withExpenseId = makeSlugMiddleware(resolveExpenseId);
export const withProductId = makeSlugMiddleware(resolveProductId);
