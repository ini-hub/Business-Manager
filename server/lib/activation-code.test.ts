import { describe, it, expect } from "vitest";
import {
  generateActivationCode,
  normalizeActivationCode,
  activationCodeExpiry,
  ACTIVATION_CODE_TTL_MS,
} from "./activation-code";

describe("generateActivationCode", () => {
  it("produces the XXXX-XXXX shape the activation email and UI both assume", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateActivationCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  // A predictable code is a bypass of the whole invitation, so a collision rate
  // meaningfully above chance would be a security bug, not a flaky test.
  it("does not repeat itself across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(generateActivationCode());
    expect(seen.size).toBeGreaterThan(19_900);
  });
});

describe("normalizeActivationCode", () => {
  it("accepts whatever shape the code arrives in", () => {
    // The same code, as pasted from an email, typed by hand, and mangled by a
    // mail client that helpfully inserted a space.
    expect(normalizeActivationCode("AB3D-9XK2")).toBe("AB3D9XK2");
    expect(normalizeActivationCode("ab3d9xk2")).toBe("AB3D9XK2");
    expect(normalizeActivationCode("ab3d 9xk2")).toBe("AB3D9XK2");
    expect(normalizeActivationCode(" AB3D—9XK2 ")).toBe("AB3D9XK2");
  });

  it("round-trips a freshly generated code", () => {
    const code = generateActivationCode();
    expect(normalizeActivationCode(code)).toHaveLength(8);
  });
});

describe("activationCodeExpiry", () => {
  it("is 48 hours out, matching what the email tells the recipient", () => {
    const now = new Date("2026-08-30T10:00:00Z");
    expect(activationCodeExpiry(now).getTime() - now.getTime()).toBe(ACTIVATION_CODE_TTL_MS);
    expect(ACTIVATION_CODE_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });
});
