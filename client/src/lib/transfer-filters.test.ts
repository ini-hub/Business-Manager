import { describe, it, expect } from "vitest";
import {
  EMPTY_TRANSFER_FILTERS,
  buildTransferFilterChips,
  clearTransferFilterChip,
  countActiveTransferFilters,
  sortTransfers,
  transferMatchesFilters,
  transferMatchesSearch,
  transferStageOf,
} from "./transfer-filters";

const now = new Date("2026-10-01T00:00:00Z");
const t = (direction: string, from: string, to: string, createdAt: string, notes = "", status = "pending") =>
  ({ direction, status, fromStore: { name: from }, toStore: { name: to }, createdAt, notes });
const rows = [
  t("outgoing", "Lekki", "Ikeja", "2026-09-28T00:00:00Z", "fragile"),
  t("incoming", "Ikeja", "Lekki", "2026-08-15T00:00:00Z"),
  t("outgoing", "Lekki", "Abuja", "2026-05-01T00:00:00Z"),
];
const count = (f: Parameters<typeof transferMatchesFilters>[1]) => rows.filter((r) => transferMatchesFilters(r, f, now)).length;

describe("transfer filters", () => {
  it("matches everything when empty", () => expect(count(EMPTY_TRANSFER_FILTERS)).toBe(3));
  it("filters by direction, route and date", () => {
    expect(count({ ...EMPTY_TRANSFER_FILTERS, direction: "outgoing" })).toBe(2);
    expect(count({ ...EMPTY_TRANSFER_FILTERS, from: ["Lekki"], to: ["Abuja"] })).toBe(1);
    expect(count({ ...EMPTY_TRANSFER_FILTERS, date: "7d" })).toBe(1);
    expect(count({ ...EMPTY_TRANSFER_FILTERS, date: "90d" })).toBe(2);
  });
  it("filters by stage, collapsing server statuses", () => {
    const staged = [t("outgoing", "A", "B", "2026-09-28T00:00:00Z", "", "accepted"), t("outgoing", "A", "B", "2026-09-28T00:00:00Z", "", "completed"), t("outgoing", "A", "B", "2026-09-28T00:00:00Z", "", "rejected"), t("outgoing", "A", "B", "2026-09-28T00:00:00Z")];
    const n = (stage: "pending" | "in_transit" | "received" | "cancelled") => staged.filter((r) => transferMatchesFilters(r, { ...EMPTY_TRANSFER_FILTERS, stage }, now)).length;
    expect([n("pending"), n("in_transit"), n("received"), n("cancelled")]).toEqual([1, 1, 1, 1]);
  });
  it("searches branches and notes", () => {
    expect(rows.filter((r) => transferMatchesSearch(r, "abuja")).length).toBe(1);
    expect(rows.filter((r) => transferMatchesSearch(r, "FRAGILE")).length).toBe(1);
  });
  it("builds and clears chips", () => {
    const f = { ...EMPTY_TRANSFER_FILTERS, direction: "incoming" as const, from: ["Ikeja"] };
    expect(countActiveTransferFilters(f)).toBe(2);
    expect(buildTransferFilterChips(f).map((c) => c.label)).toEqual(["Incoming", "From Ikeja"]);
    expect(clearTransferFilterChip(f, "from").from).toEqual([]);
  });
  it("sorts", () => {
    expect(sortTransfers(rows, { key: "oldest" })[0].toStore.name).toBe("Abuja");
    expect(sortTransfers(rows, { key: "newest" })[0].toStore.name).toBe("Ikeja");
    expect(sortTransfers(rows, { key: "route" })[0].fromStore.name).toBe("Ikeja");
  });
});

describe("transfer stages", () => {
  it("treats a stock request awaiting approval as pending", () => {
    expect(transferStageOf("requested")).toBe("pending");
    expect(transferStageOf("pending")).toBe("pending");
    expect(transferStageOf("accepted")).toBe("in_transit");
  });
});
