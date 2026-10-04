import { describe, it, expect } from "vitest";
import { applySimpleList, countPicked, simpleChips, EMPTY_SIMPLE_LIST, type SimpleListConfig } from "./simple-list";

type Row = { name: string; status: string; amount: number };
const cfg: SimpleListConfig<Row> = {
  noun: "row",
  placeholder: "Search",
  searchText: (r) => r.name,
  groups: [
    { key: "status", label: "Status", options: [{ value: "paid", label: "Paid" }, { value: "open", label: "Open" }], match: (r, v) => r.status === v },
    { key: "size", label: "Size", options: [{ value: "big", label: "Big" }], match: (r) => r.amount >= 100 },
  ],
  sorts: [{ key: "amountHigh", label: "Highest", compare: (a, b) => b.amount - a.amount }],
};
const rows: Row[] = [
  { name: "Ada", status: "paid", amount: 50 },
  { name: "Bola", status: "open", amount: 200 },
  { name: "Chi", status: "open", amount: 20 },
];

describe("simple list", () => {
  it("returns everything when nothing is set", () => expect(applySimpleList(rows, cfg, EMPTY_SIMPLE_LIST)).toHaveLength(3));
  it("searches, case-insensitively", () => {
    expect(applySimpleList(rows, cfg, { ...EMPTY_SIMPLE_LIST, search: "BOL" }).map((r) => r.name)).toEqual(["Bola"]);
  });
  it("combines groups with AND", () => {
    const state = { ...EMPTY_SIMPLE_LIST, picked: { status: "open", size: "big" } };
    expect(applySimpleList(rows, cfg, state).map((r) => r.name)).toEqual(["Bola"]);
    expect(countPicked(state)).toBe(2);
  });
  it("ignores cleared groups", () => {
    expect(applySimpleList(rows, cfg, { ...EMPTY_SIMPLE_LIST, picked: { status: null } })).toHaveLength(3);
  });
  it("sorts when a sort is chosen and leaves order otherwise", () => {
    expect(applySimpleList(rows, cfg, { ...EMPTY_SIMPLE_LIST, sortKey: "amountHigh" }).map((r) => r.name)).toEqual(["Bola", "Ada", "Chi"]);
    expect(applySimpleList(rows, cfg, EMPTY_SIMPLE_LIST).map((r) => r.name)).toEqual(["Ada", "Bola", "Chi"]);
  });
  it("builds chips from the picked options", () => {
    expect(simpleChips(cfg, { ...EMPTY_SIMPLE_LIST, picked: { status: "paid" } })).toEqual([{ key: "status", label: "Paid" }]);
  });
});
