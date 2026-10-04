import type { Application } from "express";

export interface AppRoute { method: string; path: string }

/**
 * Every route registered on an Express 4 app, with its full mounted path
 * (e.g. POST /api/products/:id/variants). It powers the admin gate-rule picker
 * and the "does that rule match anything?" check, so a super admin can only
 * gate a route that exists. Walks the router stack; mount paths are recovered
 * from the layer regexp, which Express 4 does not expose any other way.
 */
export function listAppRoutes(app: Application): AppRoute[] {
  const out = new Map<string, AppRoute>();

  const mountPath = (layer: any): string => {
    if (layer.regexp?.fast_slash) return "";
    const src: string = layer.regexp?.source ?? "";
    let keyIndex = 0;
    const path = src
      .replace("^", "")
      .replace("\\/?(?=\\/|$)", "")
      .replace("(?=\\/|$)", "")
      .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys?.[keyIndex++]?.name ?? "param"}`)
      .replace(/\\\//g, "/")
      .replace(/\$$/, "");
    return path.startsWith("/") ? path : "";
  };

  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        const full = (prefix + (layer.route.path as string)).replace(/\/+$/, "") || "/";
        for (const method of Object.keys(layer.route.methods)) {
          if (layer.route.methods[method]) {
            const m = method.toUpperCase();
            out.set(`${m} ${full}`, { method: m, path: full });
          }
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };

  walk((app as any)._router?.stack ?? [], "");
  return Array.from(out.values()).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Routes under /api that a rule could meaningfully gate (excludes protected areas via validateGateRule). */
export function listApiRoutes(app: Application): AppRoute[] {
  return listAppRoutes(app).filter((r) => r.path.startsWith("/api/"));
}
