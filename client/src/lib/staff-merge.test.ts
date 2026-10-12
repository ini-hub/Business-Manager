import { describe, it, expect } from "vitest";
import { summarise, labelFor, payLabel } from "./staff-merge";

describe("staff merge wording", () => {
  it("names known tables in plain language and falls back to a readable table name", () => {
    expect(labelFor("checkouts.lead_staff_id")).toBe("sales");
    expect(labelFor("hr_documents.staff_id")).toBe("HR documents");
    expect(labelFor("stock_audits.conducted_by_staff_id")).toBe("stock audits");
  });

  it("adds up columns of the same table and lists the biggest first", () => {
    const rows = summarise({
      "checkouts.staff_id": 12,
      "checkouts.lead_staff_id": 3,
      "attendance_records.staff_id": 20,
      "salary_advances.staff_id": 1,
    });
    expect(rows).toEqual([
      { label: "attendance days", n: 20 },
      { label: "sales", n: 15 },
      { label: "salary advances", n: 1 },
    ]);
  });

  it("describes pay columns", () => {
    expect(payLabel("pay_per_month")).toBe("monthly pay");
    expect(payLabel("active_day_rate_override")).toBe("active day rate override");
  });
});
