import { describe, it, expect } from "vitest";
import { reminderDue, reputation, statementPeriod, periodRange, shouldSendStatement, dayDiff } from "./partnerEngagement";

const d = (s: string) => new Date(`${s}T10:00:00`);

describe("reminderDue", () => {
  const due = d("2026-06-10");

  it("says nothing without a due date or well before it", () => {
    expect(reminderDue({ now: d("2026-06-01"), dueDate: null, lastRemindedAt: null })).toBeNull();
    expect(reminderDue({ now: d("2026-06-01"), dueDate: due, lastRemindedAt: null })).toBeNull();
  });

  it("gives one heads-up inside the three-day window, then waits for the day", () => {
    expect(reminderDue({ now: d("2026-06-07"), dueDate: due, lastRemindedAt: null })).toBe("upcoming");
    expect(reminderDue({ now: d("2026-06-08"), dueDate: due, lastRemindedAt: d("2026-06-07") })).toBeNull();
    expect(reminderDue({ now: d("2026-06-10"), dueDate: due, lastRemindedAt: d("2026-06-07") })).toBe("due");
  });

  it("is idempotent within a day, so an hourly job cannot repeat itself", () => {
    expect(reminderDue({ now: d("2026-06-10"), dueDate: due, lastRemindedAt: d("2026-06-10") })).toBeNull();
  });

  it("nudges weekly once overdue and stops after two months", () => {
    expect(reminderDue({ now: d("2026-06-11"), dueDate: due, lastRemindedAt: d("2026-06-10") })).toBeNull();
    expect(reminderDue({ now: d("2026-06-17"), dueDate: due, lastRemindedAt: d("2026-06-10") })).toBe("overdue");
    expect(reminderDue({ now: d("2026-06-17"), dueDate: due, lastRemindedAt: null })).toBe("overdue");
    expect(reminderDue({ now: d("2026-09-01"), dueDate: due, lastRemindedAt: d("2026-08-01") })).toBeNull();
  });
});

describe("dayDiff", () => {
  it("counts calendar days regardless of time of day", () => {
    expect(dayDiff(new Date("2026-06-10T23:59:00"), new Date("2026-06-11T00:01:00"))).toBe(1);
  });
});

describe("reputation", () => {
  const none = { received: 0, receivedComplete: 0, settled: 0, settledOnTime: 0, overdueOpen: 0, completedTransfers: 0 };

  it("is 'new' until there is enough history to judge", () => {
    expect(reputation(none)).toEqual({ score: null, label: "new" });
    expect(reputation({ ...none, received: 1, receivedComplete: 0 })).toEqual({ score: null, label: "new" });
  });

  it("scores receipt accuracy and punctual settlement equally", () => {
    const r = reputation({ ...none, received: 4, receivedComplete: 4, settled: 4, settledOnTime: 2 });
    expect(r).toEqual({ score: 75, label: "good" });
  });

  it("counts a balance that is still open past due against the score", () => {
    const r = reputation({ ...none, received: 3, receivedComplete: 3, settled: 2, settledOnTime: 2, overdueOpen: 2 });
    expect(r.score).toBe(75);
  });

  it("uses whichever signal has data", () => {
    expect(reputation({ ...none, received: 5, receivedComplete: 5 })).toEqual({ score: 100, label: "reliable" });
    expect(reputation({ ...none, received: 5, receivedComplete: 1 }).label).toBe("needs_attention");
  });
});

describe("statements", () => {
  it("covers the previous month and only goes out in the first week", () => {
    expect(statementPeriod(d("2026-06-03"))).toBe("2026-05");
    expect(statementPeriod(d("2026-01-02"))).toBe("2025-12");
    expect(statementPeriod(d("2026-06-08"))).toBeNull();
  });

  it("spans the whole month", () => {
    const { from, to } = periodRange("2026-05");
    expect(from.getMonth()).toBe(4);
    expect(to.getMonth()).toBe(5);
    expect(to.getDate()).toBe(1);
  });

  it("is skipped when nothing happened and nothing is owed", () => {
    expect(shouldSendStatement({ openBalances: 0, activityInPeriod: 0 })).toBe(false);
    expect(shouldSendStatement({ openBalances: 1, activityInPeriod: 0 })).toBe(true);
    expect(shouldSendStatement({ openBalances: 0, activityInPeriod: 2 })).toBe(true);
  });
});
