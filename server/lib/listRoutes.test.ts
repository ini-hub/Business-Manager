import { describe, it, expect } from "vitest";
import express, { Router } from "express";
import { listAppRoutes } from "./listRoutes";

describe("listAppRoutes", () => {
  it("returns mounted, nested and parameterised routes with full paths", () => {
    const app = express();
    app.post("/api/expenses", (_req, res) => res.end());
    const credit = Router();
    credit.post("/credit/entries", (_req, res) => res.end());
    credit.get("/credit/entries/:id", (_req, res) => res.end());
    app.use("/api", credit);
    const nested = Router();
    nested.patch("/:id/variants", (_req, res) => res.end());
    app.use("/api/products", nested);

    const routes = listAppRoutes(app).map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain("POST /api/expenses");
    expect(routes).toContain("POST /api/credit/entries");
    expect(routes).toContain("GET /api/credit/entries/:id");
    expect(routes).toContain("PATCH /api/products/:id/variants");
  });
});
