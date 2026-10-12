import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Page titles follow one scale on every screen size: 18px on phones, 26px from 640px (see the h1 rule
 * in index.css). A heading that sets its own text size would drift from that, so this fails on it.
 * Landing and auth screens have their own CSS and are exempt.
 */
const SRC = path.resolve(__dirname, "..");
const EXEMPT = [/landing\.tsx$/, /email-otp-form\.tsx$/, /[\\/]auth[\\/]/];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

const SIZE_CLASS = /(?:^|\s)(?:[a-z]+:)*text-(?:\[\d+(?:\.\d+)?px\]|xs|sm|base|lg|xl|2xl|3xl|4xl)(?=\s|$)/;

describe("type scale", () => {
  it("no <h1> sets its own text size", () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      if (EXEMPT.some((r) => r.test(f))) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/<h1\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/gs)) {
        if (SIZE_CLASS.test(m[1] ?? m[2] ?? "")) offenders.push(path.relative(SRC, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("PageHeader and SettingsPageHeader leave the title size to the h1 rule", () => {
    const header = fs.readFileSync(path.join(SRC, "components/page-header.tsx"), "utf8");
    const settings = fs.readFileSync(path.join(SRC, "components/settings-page-header.tsx"), "utf8");
    expect(header).toMatch(/<h1 className="truncate">/);
    expect(settings).not.toMatch(/<span className="[^"]*text-(?:lg|xl|2xl)/);
  });
});
