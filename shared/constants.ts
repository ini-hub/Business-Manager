/**
 * App-wide shared constants. Safe to import from both the browser and the
 * server: no drizzle, no `sql`.
 */

/**
 * Hard cap on how many non-deleted variants a single product can have.
 * Enforced both client-side (blocks the "Add Variants" submit before it
 * fires a batch of POSTs) and server-side (the real backstop, since the
 * client check can be bypassed by a direct API call). 100 is generous for
 * legitimate attribute combos (e.g. size x color x material) while still
 * bounding runaway/accidental bulk creation.
 */
export const MAX_VARIANTS_PER_PRODUCT = 100;
