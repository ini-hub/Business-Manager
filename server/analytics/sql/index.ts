/**
 * Analytics Explorer — the SQL binding registry.
 *
 * The catalog (browser-safe) and the bindings (server-only) are two halves of one
 * model held together by string ids. `assertBindingsComplete()` is what stops
 * them drifting: it runs at boot and fails loudly rather than letting a measure
 * 404 at query time, or — worse — letting a binding exist for a measure the
 * catalog never exposes.
 */

import type { CubeId } from "@shared/analytics/model";
import { CUBES, MEASURES } from "@shared/analytics/catalog";
import type { CubeSql, MeasureSql } from "./types";
import { salesLinesCube, salesReceiptsCube } from "./sales";
import {
  attendanceCube,
  bookingsCube,
  consumablesCube,
  creditCube,
  customersCube,
  expensesCube,
  inventoryCube,
  payrollCube,
} from "./operations";

const registry = new Map<CubeId, CubeSql>([
  ["sales_lines", salesLinesCube],
  ["sales_receipts", salesReceiptsCube],
  ["expenses", expensesCube],
  ["consumables", consumablesCube],
  ["attendance", attendanceCube],
  ["payroll", payrollCube],
  ["credit", creditCube],
  ["inventory", inventoryCube],
  ["customers", customersCube],
  ["bookings", bookingsCube],
]);

export const CUBE_SQL: ReadonlyMap<CubeId, CubeSql> = registry;

export function getCubeSql(id: CubeId): CubeSql | undefined {
  return registry.get(id);
}

/**
 * Resolves a measure's binding, searching the cube that owns it first.
 *
 * Cross-cube derived measures (avg_basket needs net_revenue from `sales_lines`
 * and receipts from `sales_receipts`) are bound on the cube named in the
 * catalog, so a lookup that misses falls through to the other registered cubes.
 */
export function getMeasureSql(cubeId: CubeId, measureId: string): MeasureSql | undefined {
  const own = registry.get(cubeId)?.measures[measureId];
  if (own) return own;
  const cubes = Array.from(registry.values());
  for (let i = 0; i < cubes.length; i++) {
    const found = cubes[i].measures[measureId];
    if (found) return found;
  }
  return undefined;
}

/**
 * Proves every catalog id has exactly one binding, and vice versa.
 *
 * Called from registerRoutes at boot. A mismatch is a programming error, not a
 * runtime condition — failing at startup beats failing on a user's query.
 */
export function assertBindingsComplete(): void {
  const problems: string[] = [];

  // Only cubes the catalog actually publishes need bindings; Phase 0 ships the
  // sales cubes, and the rest are added alongside their catalog entries.
  for (const cube of CUBES) {
    if (!registry.has(cube.id)) {
      problems.push(`Cube "${cube.id}" is in the catalog but has no SQL binding.`);
    }
  }

  Array.from(registry.keys()).forEach((cubeId) => {
    if (!CUBES.some((c) => c.id === cubeId)) {
      problems.push(`Cube "${cubeId}" has a SQL binding but is not in the catalog.`);
    }
  });

  const publishedCubes = new Set(CUBES.map((c) => c.id));

  for (const measure of MEASURES) {
    if (!publishedCubes.has(measure.cube)) continue;
    const binding = getMeasureSql(measure.cube, measure.id);
    if (!binding) {
      problems.push(`Measure "${measure.id}" has no SQL binding.`);
      continue;
    }
    // A catalog measure with `derivedFrom` must be bound as derived, and one
    // without must be bound as an aggregate. Getting this backwards produces a
    // ratio that is summed — silently wrong at every roll-up level.
    const catalogSaysDerived = (measure.derivedFrom?.length ?? 0) > 0;
    const bindingIsDerived = binding.kind === "derived";
    if (catalogSaysDerived !== bindingIsDerived) {
      problems.push(
        `Measure "${measure.id}" is ${catalogSaysDerived ? "derived" : "aggregated"} in the ` +
          `catalog but ${bindingIsDerived ? "derived" : "aggregated"} in its SQL binding.`,
      );
    }
  }

  const catalogMeasureIds = new Set(MEASURES.map((m) => m.id));
  Array.from(registry.entries()).forEach(([cubeId, cube]) => {
    for (const measureId of Object.keys(cube.measures)) {
      if (!catalogMeasureIds.has(measureId)) {
        problems.push(`Cube "${cubeId}" binds "${measureId}", which is not in the catalog.`);
      }
    }
    for (const dimensionId of Object.keys(cube.dimensions)) {
      const declared = CUBES.find((c) => c.id === cubeId)?.dimensions ?? [];
      if (!declared.includes(dimensionId)) {
        problems.push(
          `Cube "${cubeId}" binds dimension "${dimensionId}", which its catalog entry ` +
            `does not declare.`,
        );
      }
    }
  });

  if (problems.length > 0) {
    throw new Error(
      `Analytics model is inconsistent with its SQL bindings:\n  - ${problems.join("\n  - ")}`,
    );
  }
}
