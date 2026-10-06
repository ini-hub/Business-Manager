import { describe, it, expect } from "vitest";
import { checkSubmittedOtp, resendWaitSeconds, MAX_OTP_ATTEMPTS, OTP_TTL_MS } from "./otp-cooldown";

const now = new Date("2026-01-01T12:00:00Z");
const live = (attempts = 0) => ({ otpCode: "123456", otpExpiry: new Date(now.getTime() + 5 * 60_000), otpAttempts: attempts });

describe("checkSubmittedOtp", () => {
  it("accepts a matching, unexpired code", () => {
    expect(checkSubmittedOtp(live(), "123456", true, now)).toEqual({ ok: true });
  });
  it("counts down tries on a wrong code and locks on the last one", () => {
    expect(checkSubmittedOtp(live(0), "000000", false, now)).toEqual({ ok: false, code: "OTP_INVALID", attemptsLeft: MAX_OTP_ATTEMPTS - 1 });
    expect(checkSubmittedOtp(live(MAX_OTP_ATTEMPTS - 1), "000000", false, now)).toEqual({ ok: false, code: "OTP_LOCKED", attemptsLeft: 0 });
  });
  it("stays locked even for the right code", () => {
    expect(checkSubmittedOtp(live(MAX_OTP_ATTEMPTS), "123456", true, now)).toMatchObject({ code: "OTP_LOCKED" });
  });
  it("expires without costing a try, even if the code is right", () => {
    const old = { ...live(2), otpExpiry: new Date(now.getTime() - 1) };
    expect(checkSubmittedOtp(old, "123456", true, now)).toMatchObject({ code: "OTP_EXPIRED", attemptsLeft: MAX_OTP_ATTEMPTS - 2 });
  });
  it("fails closed when the code or expiry is missing", () => {
    expect(checkSubmittedOtp({ otpCode: null, otpExpiry: null, otpAttempts: 0 }, "1", false, now)).toMatchObject({ code: "OTP_EXPIRED" });
    expect(checkSubmittedOtp({ otpCode: "123456", otpExpiry: null, otpAttempts: 0 }, "123456", true, now)).toMatchObject({ code: "OTP_EXPIRED" });
  });
});

describe("resendWaitSeconds", () => {
  it("makes a fresh send wait out the 45 second gap", () => {
    const sentJustNow = { otpCode: "1", otpExpiry: new Date(now.getTime() + OTP_TTL_MS), otpAttempts: 0 };
    expect(resendWaitSeconds(sentJustNow, now)).toBe(45);
    expect(resendWaitSeconds(sentJustNow, new Date(now.getTime() + 46_000))).toBe(0);
  });
  it("lets an expired or locked code be replaced immediately", () => {
    const sentJustNow = { otpCode: "1", otpExpiry: new Date(now.getTime() + OTP_TTL_MS), otpAttempts: MAX_OTP_ATTEMPTS };
    expect(resendWaitSeconds(sentJustNow, now)).toBe(0);
    expect(resendWaitSeconds({ otpCode: "1", otpExpiry: new Date(now.getTime() - 1), otpAttempts: 0 }, now)).toBe(0);
  });
});
