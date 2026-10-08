/**
 * What store staff may see of a partner transfer: what is coming or going and how it is going,
 * never what it is worth or what is owed. Built as an allow-list, so a field added to the
 * transfer later stays hidden from staff until someone decides it should not be.
 */

type Row = Record<string, any>;

const LIST_FIELDS = [
  "id", "kind", "side", "status", "yourTurn", "createdAt", "fromOrgName", "toOrgName", "fromStoreName", "toStoreName", "fromStoreId", "toStoreId",
] as const;

const DETAIL_FIELDS = [
  ...LIST_FIELDS, "notes", "rejectionReason", "fromOrgId", "toOrgId", "acceptedAt", "shippedAt", "receivedAt",
] as const;

const ITEM_FIELDS = ["id", "name", "sku", "unit", "quantity", "confirmedQuantity", "shortfallReason", "shortfallNote"] as const;

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

export const staffListRow = (row: Row): Row => pick(row, LIST_FIELDS);

export function staffDetail(t: Row): Row {
  return {
    ...pick(t, DETAIL_FIELDS),
    items: (t.items ?? []).map((i: Row) => pick(i, ITEM_FIELDS)),
    // The timeline is kept, but without the amounts and terms recorded in each event's detail.
    events: (t.events ?? []).map((e: Row) => ({ ...pick(e, ["id", "event", "createdAt", "orgId"]) })),
  };
}

/** Events that exist only to discuss money say nothing useful to a storekeeper and would hint at it. */
const MONEY_EVENTS = new Set([
  "settlement_set", "settlement_proposed", "settlement_agreed", "settlement_declined",
  "settlement_recorded", "settlement_claimed", "settlement_confirmed", "settlement_rejected", "balance_waived",
]);

export function staffDetailWithoutMoneyEvents(t: Row): Row {
  const d = staffDetail(t);
  return { ...d, events: d.events.filter((e: Row) => !MONEY_EVENTS.has(e.event)) };
}
