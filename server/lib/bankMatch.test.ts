import { describe, it, expect } from "vitest";
import { matchCredits, MATCH_WINDOW_MS, type MatchLeg, type MatchCredit } from "./bankMatch";

const t0 = new Date("2026-10-01T10:00:00Z");
const leg = (id: string, amount: number, over: Partial<MatchLeg> = {}): MatchLeg =>
  ({ id, amount, createdAt: t0, reference: null, senderName: null, ...over });
const credit = (id: string, amount: number, over: Partial<MatchCredit> = {}): MatchCredit =>
  ({ id, amount, postedAt: new Date(t0.getTime() + 5 * 60_000), narration: null, ...over });

describe("matchCredits", () => {
  it("matches a single leg with the same amount", () => {
    expect(matchCredits([credit("c1", 5000)], [leg("l1", 5000), leg("l2", 7500)])).toEqual([{ creditId: "c1", legId: "l1" }]);
  });

  it("matches to the kobo, not approximately", () => {
    const [r] = matchCredits([credit("c1", 5000.01)], [leg("l1", 5000)]);
    expect(r).toMatchObject({ legId: null, reason: "none" });
  });

  it("ignores legs outside the time window", () => {
    const old = leg("l1", 5000, { createdAt: new Date(t0.getTime() - MATCH_WINDOW_MS - 1000) });
    expect(matchCredits([credit("c1", 5000)], [old])[0]).toMatchObject({ legId: null, reason: "none" });
  });

  it("reports ambiguity when two legs share an amount", () => {
    const r = matchCredits([credit("c1", 5000)], [leg("l1", 5000), leg("l2", 5000)]);
    expect(r[0]).toMatchObject({ legId: null, reason: "ambiguous" });
  });

  it("breaks a tie using the sender name in the narration", () => {
    const legs = [leg("l1", 5000, { senderName: "Ada Obi" }), leg("l2", 5000, { senderName: "Musa Bello" })];
    const r = matchCredits([credit("c1", 5000, { narration: "TRF FROM MUSA B / POS" })], legs);
    expect(r[0]).toEqual({ creditId: "c1", legId: "l2" });
  });

  it("breaks a tie using the reference in the narration", () => {
    const legs = [leg("l1", 5000, { reference: "REC-1042" }), leg("l2", 5000, { reference: "REC-2077" })];
    expect(matchCredits([credit("c1", 5000, { narration: "payment rec2077" })], legs)[0]).toEqual({ creditId: "c1", legId: "l2" });
  });

  it("stays ambiguous when hints fit both legs", () => {
    const legs = [leg("l1", 5000, { senderName: "Ada Obi" }), leg("l2", 5000, { senderName: "Ada Obi" })];
    expect(matchCredits([credit("c1", 5000, { narration: "from ADA OBI" })], legs)[0]).toMatchObject({ legId: null, reason: "ambiguous" });
  });

  it("uses each leg for at most one credit in a pass", () => {
    const r = matchCredits([credit("c1", 5000), credit("c2", 5000, { postedAt: new Date(t0.getTime() + 10 * 60_000) })], [leg("l1", 5000)]);
    expect(r).toEqual([{ creditId: "c1", legId: "l1" }, { creditId: "c2", legId: null, reason: "none" }]);
  });
});

import { refundsWithoutDebit, REFUND_MATCH_WINDOW_MS } from "./bankMatch";

describe("refundsWithoutDebit", () => {
  const refund = (id: string, amount: number, at = t0) => ({ id, amount, createdAt: at });
  const debit = (id: string, amount: number, at = t0) => ({ id, amount, postedAt: at });

  it("returns nothing when every refund has a debit", () => {
    expect(refundsWithoutDebit([refund("r1", 1500)], [debit("d1", 1500, new Date(t0.getTime() + 3600_000))])).toEqual([]);
  });

  it("flags a refund with no debit of that amount", () => {
    expect(refundsWithoutDebit([refund("r1", 1500)], [debit("d1", 1400)]).map((r) => r.id)).toEqual(["r1"]);
  });

  it("flags a refund whose debit is outside the window", () => {
    const late = debit("d1", 1500, new Date(t0.getTime() + REFUND_MATCH_WINDOW_MS + 1000));
    expect(refundsWithoutDebit([refund("r1", 1500)], [late]).map((r) => r.id)).toEqual(["r1"]);
  });

  it("lets one debit cover only one of two identical refunds", () => {
    const out = refundsWithoutDebit([refund("r1", 1500), refund("r2", 1500, new Date(t0.getTime() + 60_000))], [debit("d1", 1500)]);
    expect(out.map((r) => r.id)).toEqual(["r2"]);
  });
});
