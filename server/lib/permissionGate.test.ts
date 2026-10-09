import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { GATED_API_DOMAINS, GATED_REPORT_PATHS, requirePermission } from "./permissionGate";
import { isPermissionKey } from "@shared/permissions";

vi.mock("./roles", () => ({ getRoleRows: vi.fn() }));
import { getRoleRows } from "./roles";

function run(role: string | undefined, rows: any[], key = "/vendors", ...legacy: string[]) {
  (getRoleRows as any).mockResolvedValue(rows);
  const req: any = { user: role ? { role, businessId: "b1" } : undefined };
  const out: { status?: number; next: boolean } = { next: false };
  const res: any = { status: (s: number) => ((out.status = s), { json: () => undefined }) };
  return requirePermission(key, ...legacy)(req, res, () => (out.next = true)).then(() => out);
}

describe("requirePermission", () => {
  it("rejects an unauthenticated request and always lets the owner through", async () => {
    expect((await run(undefined, [])).status).toBe(401);
    expect((await run("owner", [])).next).toBe(true);
  });

  it("behaves like requireRole for a built-in role nobody has customised", async () => {
    expect((await run("manager", [])).next).toBe(true);
    expect((await run("staff", [])).status).toBe(403);
    expect((await run("manager", [], "/vendors", "owner")).status).toBe(403);
  });

  it("follows the saved override once a super admin changes a built-in role", async () => {
    const managerWithout = [{ name: "Manager", kind: "system", permissions: ["/customers"] }];
    expect((await run("manager", managerWithout)).status).toBe(403);
    const staffWith = [{ name: "Staff", kind: "system", permissions: ["/vendors"] }];
    expect((await run("staff", staffWith)).next).toBe(true);
  });

  it("holds a custom role to its pages", async () => {
    const rows = [{ name: "Buyer", kind: "custom", permissions: ["/vendors"] }];
    expect((await run("buyer", rows)).next).toBe(true);
    expect((await run("buyer", rows, "/inventory")).status).toBe(403);
    expect((await run("ghost", rows)).status).toBe(403);
  });
});

describe("converted route groups stay on requirePermission", () => {
  it("only maps domains to real pages", () => {
    for (const key of [...Object.values(GATED_API_DOMAINS), ...Object.values(GATED_REPORT_PATHS)]) expect(isPermissionKey(key)).toBe(true);
  });

  it("has no manager-level route in a converted domain on a hardcoded role check", () => {
    const dir = path.resolve(__dirname, "../routes");
    const offenders: string[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".routes.ts"))) {
      fs.readFileSync(path.join(dir, file), "utf8").split("\n").forEach((line, i) => {
        const route = line.match(/app\.(?:get|post|put|patch|delete)\(\s*["'`](\/api\/[^"'`]+)/);
        if (!route) return;
        const hardcoded = /requireManagerOrOwner(?![\w(])|requireRole\(\s*"(?:owner",\s*"manager|manager",\s*"owner)"\s*\)/.test(line);
        if (!hardcoded) return;
        const domain = route[1].split("/")[2];
        const gated = domain in GATED_API_DOMAINS || Object.keys(GATED_REPORT_PATHS).some((p) => route[1].startsWith(p));
        if (gated) offenders.push(`${file}:${i + 1} ${route[1]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
