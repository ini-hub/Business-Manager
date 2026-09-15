import { describe, it, expect } from "vitest";
import {
  createEmptySelection,
  toggleRow,
  toggleRange,
  toggleSelectAllOnPage,
  selectAllMatching,
  clearSelection,
  getSelectionCount,
  isRowSelected,
  headerCheckboxState,
  shouldShowSelectAllBanner,
} from "./table-selection";

const page = ["a", "b", "c", "d", "e"];

describe("toggleRow", () => {
  it("selects then deselects a row", () => {
    let s = createEmptySelection<string>();
    s = toggleRow(s, "b", page);
    expect(isRowSelected(s, "b")).toBe(true);
    expect(isRowSelected(s, "a")).toBe(false);
    s = toggleRow(s, "b", page);
    expect(isRowSelected(s, "b")).toBe(false);
  });

  it("deselecting one row while in 'all' mode exits all-mode, keeping the rest of the page selected", () => {
    let s = selectAllMatching<string>();
    s = toggleRow(s, "c", page);
    expect(s.mode).toBe("page");
    expect(isRowSelected(s, "c")).toBe(false);
    expect(isRowSelected(s, "a")).toBe(true);
    expect(isRowSelected(s, "e")).toBe(true);
  });
});

describe("toggleRange (shift+click)", () => {
  it("selects the contiguous range between anchor and target", () => {
    let s = createEmptySelection<string>();
    s = toggleRow(s, "b", page); // anchor = b
    s = toggleRange(s, "d", page); // range b..d
    expect(isRowSelected(s, "a")).toBe(false);
    expect(isRowSelected(s, "b")).toBe(true);
    expect(isRowSelected(s, "c")).toBe(true);
    expect(isRowSelected(s, "d")).toBe(true);
    expect(isRowSelected(s, "e")).toBe(false);
  });

  it("works in reverse order (target before anchor)", () => {
    let s = createEmptySelection<string>();
    s = toggleRow(s, "d", page);
    s = toggleRange(s, "b", page);
    expect(["b", "c", "d"].every((id) => isRowSelected(s, id))).toBe(true);
    expect(isRowSelected(s, "a")).toBe(false);
    expect(isRowSelected(s, "e")).toBe(false);
  });

  it("falls back to a plain toggle with no prior anchor", () => {
    const s = toggleRange(createEmptySelection<string>(), "c", page);
    expect(isRowSelected(s, "c")).toBe(true);
    expect(getSelectionCount(s, 5)).toBe(1);
  });
});

describe("toggleSelectAllOnPage", () => {
  it("selects only the current page, not the full filtered set", () => {
    const s = toggleSelectAllOnPage(createEmptySelection<string>(), page);
    expect(getSelectionCount(s, 65)).toBe(5);
    expect(s.mode).toBe("page");
  });

  it("clicking again clears the page selection", () => {
    let s = toggleSelectAllOnPage(createEmptySelection<string>(), page);
    s = toggleSelectAllOnPage(s, page);
    expect(getSelectionCount(s, 65)).toBe(0);
  });

  it("clears entirely when clicked while in all-mode", () => {
    let s = selectAllMatching<string>();
    s = toggleSelectAllOnPage(s, page);
    expect(s.mode).toBe("page");
    expect(getSelectionCount(s, 65)).toBe(0);
  });
});

describe("headerCheckboxState", () => {
  it("is unchecked with nothing selected", () => {
    expect(headerCheckboxState(createEmptySelection<string>(), page)).toBe("unchecked");
  });

  it("is indeterminate with a partial page selection", () => {
    let s = createEmptySelection<string>();
    s = toggleRow(s, "a", page);
    s = toggleRow(s, "b", page);
    expect(headerCheckboxState(s, page)).toBe("indeterminate");
  });

  it("is checked when every row on the page is selected", () => {
    const s = toggleSelectAllOnPage(createEmptySelection<string>(), page);
    expect(headerCheckboxState(s, page)).toBe("checked");
  });

  it("is checked in all-mode regardless of page contents", () => {
    expect(headerCheckboxState(selectAllMatching<string>(), page)).toBe("checked");
  });
});

describe("shouldShowSelectAllBanner", () => {
  it("shows the page-scoped prompt once every row on the page is selected and more exist", () => {
    const s = toggleSelectAllOnPage(createEmptySelection<string>(), page);
    expect(shouldShowSelectAllBanner(s, page, 65)).toBe(true);
  });

  it("does not show when the page selection covers the entire filtered set", () => {
    const s = toggleSelectAllOnPage(createEmptySelection<string>(), page);
    expect(shouldShowSelectAllBanner(s, page, 5)).toBe(false);
  });

  it("does not show with a partial selection", () => {
    const s = toggleRow(createEmptySelection<string>(), "a", page);
    expect(shouldShowSelectAllBanner(s, page, 65)).toBe(false);
  });

  it("shows the all-selected variant once in all-mode", () => {
    expect(shouldShowSelectAllBanner(selectAllMatching<string>(), page, 65)).toBe(true);
  });
});

describe("select all across pages (acceptance: header checkbox selects only the current page)", () => {
  it("25 of 65 selected via header checkbox, then 'Select all 65' promotes to all-mode", () => {
    const pageOf25 = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    let s = toggleSelectAllOnPage(createEmptySelection<string>(), pageOf25);
    expect(getSelectionCount(s, 65)).toBe(25);
    expect(shouldShowSelectAllBanner(s, pageOf25, 65)).toBe(true);

    s = selectAllMatching<string>();
    expect(getSelectionCount(s, 65)).toBe(65);
  });
});

describe("clearSelection", () => {
  it("resets to an empty page-mode selection from any state", () => {
    const fromAll = clearSelection<string>();
    expect(fromAll.mode).toBe("page");
    expect(fromAll.ids.size).toBe(0);
  });
});
