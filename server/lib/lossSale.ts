export type RecipeLine = { supplyInventoryId: string; quantityPerUnit: number };

/** Full cost of one unit: the item's own cost plus what its consumables recipe burns. */
export function fullUnitCost(
  itemCostPrice: number,
  recipe: RecipeLine[] | undefined,
  supplyCosts: Map<string, number>,
): number {
  const recipeCost = (recipe ?? []).reduce(
    (sum, r) => sum + r.quantityPerUnit * (supplyCosts.get(r.supplyInventoryId) ?? 0),
    0,
  );
  return (Number(itemCostPrice) || 0) + recipeCost;
}

/** How far below full cost a line sold (0 when at or above cost). Rounded to kobo. */
export function lineLossAmount(unitPrice: number, quantity: number, unitCost: number): number {
  const loss = unitCost * quantity - unitPrice * quantity;
  return loss > 0.005 ? Math.round(loss * 100) / 100 : 0;
}
