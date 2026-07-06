import { db } from "../db";
import {
  inventory,
  customers,
  vendors,
  vendorBills,
  expenses,
  products,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
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

/**
 * Resolves an inventory slug, falling back to the products table.
 * This matches the PATCH/DELETE route logic that checks both tables.
 */
async function resolveInventoryOrProductId(param: string): Promise<string | null> {
  const inventoryId = await resolveInventoryId(param);
  if (inventoryId) return inventoryId;
  return resolveProductId(param);
}
export const resolveCustomerId = (p: string) => resolveParam(p, customers);
export const resolveVendorId = (p: string) => resolveParam(p, vendors);
export const resolveVendorBillId = (p: string) => resolveParam(p, vendorBills);
export const resolveExpenseId = (p: string) => resolveParam(p, expenses);
export const resolveProductId = (p: string) => resolveParam(p, products);

/**
 * Resolves a product slug. If the slug matches an inventory item (variant)
 * rather than a product group, returns the variant's parent product ID instead.
 * This allows variant URLs to transparently serve the parent product group page.
 */
async function resolveProductOrParentId(param: string): Promise<string | null> {
  // 1. Try the products table directly
  const productId = await resolveProductId(param);
  if (productId) return productId;

  // 2. Try the inventory table — if found, return the parent product's ID
  const variantId = await resolveInventoryId(param);
  if (!variantId) return null;

  const [row] = await db
    .select({ productId: inventory.productId })
    .from(inventory)
    .where(eq(inventory.id, variantId))
    .limit(1);

  return row?.productId ?? null;
}

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

export const withInventoryId = makeSlugMiddleware(resolveInventoryOrProductId);
export const withCustomerId = makeSlugMiddleware(resolveCustomerId);
export const withVendorId = makeSlugMiddleware(resolveVendorId);
export const withVendorBillId = makeSlugMiddleware(resolveVendorBillId, "billId");
export const withExpenseId = makeSlugMiddleware(resolveExpenseId);
export const withProductId = makeSlugMiddleware(resolveProductOrParentId);
