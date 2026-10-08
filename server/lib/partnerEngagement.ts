/**
 * Pure rules for partner reminders, reputation and the monthly statement. No database access,
 * so the services stay thin and the thresholds can be pinned by tests.
 */

const DAY = 24 * 60 * 60 * 1000;

export type ReminderKind = "upcoming" | "due" | "overdue";

export const UPCOMING_DAYS = 3;
export const OVERDUE_REPEAT_DAYS = 7;
export const OVERDUE_STOP_DAYS = 60;

/** Calendar-day difference, ignoring time of day: positive when `b` is later than `a`. */
export function dayDiff(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY);
}

/**
 * Which reminder, if any, an open balance is owed today. One heads-up three days ahead, one on
 * the day, then a nudge each week once overdue, and silence after two months so a dead balance
 * does not nag forever. `lastRemindedAt` makes the job safe to run every hour.
 */
export function reminderDue(input: { now: Date; dueDate: Date | null; lastRemindedAt: Date | null }): ReminderKind | null {
  const { now, dueDate, lastRemindedAt } = input;
  if (!dueDate) return null;
  const untilDue = dayDiff(now, dueDate);
  const sinceReminded = lastRemindedAt ? dayDiff(lastRemindedAt, now) : Infinity;

  if (untilDue > UPCOMING_DAYS) return null;
  if (untilDue > 0) return sinceReminded > UPCOMING_DAYS ? "upcoming" : null; // once, inside the window
  if (untilDue === 0) return sinceReminded >= 1 ? "due" : null;
  const overdueBy = -untilDue;
  if (overdueBy > OVERDUE_STOP_DAYS) return null;
  return sinceReminded >= OVERDUE_REPEAT_DAYS ? "overdue" : null;
}

export interface ReputationStats {
  /** Transfers this business received, and how many arrived complete. */
  received: number;
  receivedComplete: number;
  /** Balances this business owed that have reached an outcome, and how many were cleared by their due date. */
  settled: number;
  settledOnTime: number;
  /** Balances still open past their due date. */
  overdueOpen: number;
  /** Transfers completed in either direction. */
  completedTransfers: number;
}

export type ReputationLabel = "new" | "reliable" | "good" | "needs_attention";

const MIN_EVIDENCE = 3;

/**
 * A partner's track record as a 0-100 score, shown to other partners. Too little history reads
 * as "new" rather than a number, because one late payment out of one would otherwise score zero.
 * Receipt accuracy and on-time settlement count equally; whichever has no data is left out.
 */
export function reputation(s: ReputationStats): { score: number | null; label: ReputationLabel } {
  const parts: number[] = [];
  if (s.received >= 1) parts.push(s.receivedComplete / s.received);
  const owed = s.settled + s.overdueOpen;
  if (owed >= 1) parts.push(s.settledOnTime / owed);

  const evidence = s.received + owed;
  if (evidence < MIN_EVIDENCE || parts.length === 0) return { score: null, label: "new" };
  const score = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
  return { score, label: score >= 90 ? "reliable" : score >= 70 ? "good" : "needs_attention" };
}

/** Statement period (YYYY-MM) a run on `now` should send, or null outside the first week of the month. */
export function statementPeriod(now: Date): string | null {
  if (now.getDate() > 7) return null;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/** First and last instant of a YYYY-MM period, for filtering the month's activity. */
export function periodRange(period: string): { from: Date; to: Date } {
  const [y, m] = period.split("-").map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
}

/** A statement is worth sending only when something happened or something is still owed. */
export function shouldSendStatement(x: { openBalances: number; activityInPeriod: number }): boolean {
  return x.openBalances > 0 || x.activityInPeriod > 0;
}
