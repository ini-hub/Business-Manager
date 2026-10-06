import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { APP_SCREEN_PATHS } from "../../shared/screens";
import { featureForScreen, gatedFeatureForScreen, FEATURES } from "../../shared/features";

/**
 * Every client route must belong to a feature in shared/features.ts, and the
 * pages App.tsx actually wraps in a feature gate must be exactly the ones the
 * registry says are gated (so the sidebar lock and the page can't disagree).
 */
const src = fs.readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

const routePaths = Array.from(src.matchAll(/<Route path="([^"]+)"/g), (m) => m[1]);

// The platform admin console is not a customer-facing feature.
const isPlatform = (p: string) => p.startsWith("/super-admin");

describe("client routes vs feature registry", () => {
  it("finds the routes (guards against the scan matching nothing)", () => {
    expect(routePaths.length).toBeGreaterThan(100);
  });

  it("keeps the admin gate-rule screen picker in step with App.tsx", () => {
    const notPickable = /^\/(super-admin|auth|activate|my-booking|terms|privacy|data-usage|legal|onboarding|complete-profile|guarantor|verify)(\/|$)/;
    const appScreens = Array.from(new Set(routePaths.filter((p) => !notPickable.test(p)))).sort();
    expect([...APP_SCREEN_PATHS].sort()).toEqual(appScreens);
  });

  it("assigns every customer-facing route to a feature", () => {
    const unowned = routePaths.filter((p) => !isPlatform(p) && !featureForScreen(p));
    expect(unowned).toEqual([]);
  });

  it("wraps pages in FeatureGate with the registry's key, and every gated screen resolves to a feature", () => {
    const gateKeyByComponent = new Map(
      Array.from(src.matchAll(/const (Gated\w+) = withFeatureGate\("(\w+)"/g), (m) => [m[1], m[2]] as const),
    );
    expect(gateKeyByComponent.size).toBeGreaterThan(0);

    const wrapped = new Map<string, string>();
    for (const m of src.matchAll(/<Route path="([^"]+)"(?:(?!<Route)[\s\S]){0,200}?(Gated\w+)/g)) {
      wrapped.set(m[1], gateKeyByComponent.get(m[2])!);
    }

    for (const [route, key] of wrapped) expect(gatedFeatureForScreen(route), route).toBe(key);

    // Every other gated screen is locked by the router-level ScreenGate, which reads the same
    // registry (gatedFeatureForScreen), so only the pages that need a bespoke wrapper are listed above.
    const registryGated = FEATURES.flatMap((f) => ((f as { gatedScreens?: readonly string[] }).gatedScreens ?? []).map((s) => s));
    for (const screen of registryGated) expect(gatedFeatureForScreen(screen), screen).not.toBeNull();
  });

  it("leaves lists of data an org already owns readable", () => {
    expect(gatedFeatureForScreen("/expenses")).toBeNull();
    expect(gatedFeatureForScreen("/expenses/new")).toBe("financial_management");
    expect(gatedFeatureForScreen("/customers")).toBeNull();
  });

  it("resolves the most specific owner", () => {
    expect(featureForScreen("/expenses")).toBe("expenses_tracking");
    expect(featureForScreen("/staffs/new")).toBe("staff_seats_addon");
    expect(featureForScreen("/staffs/123/edit")).toBe("staff_management");
    expect(featureForScreen("/staffs/attendance")).toBe("attendance_management");
    expect(featureForScreen("/")).toBe("core_platform");
    expect(featureForScreen("/nonsense")).toBeNull();
  });
});
