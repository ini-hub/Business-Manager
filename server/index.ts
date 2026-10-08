import "./lib/loadEnv";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { recordRequest, startHealthMetricsFlush } from "./lib/healthMetrics";
import { runWithRequestStats, type RequestStats } from "./lib/queryCounter";
import { serveStatic } from "./static";
import { createServer } from "http";
import helmet from "helmet";
import { csrfMiddleware } from "./csrf";
import { buildCspDirectives } from "./csp";
import { startBookingReminderService } from "./services/BookingReminderService";
import { startWhatsAppConversationTimeoutSweeper } from "./services/WhatsAppBookingConversationEngine";
import { startCreditReminderService } from "./services/CreditReminderService";
import { startPartnerReminderService } from "./services/PartnerReminderService";
import { startTrialReminderService } from "./services/TrialReminderService";
import { startFeatureSunsetReminderService } from "./services/FeatureSunsetReminderService";
import { startAttendanceDayCloseService } from "./services/AttendanceDayCloseService";
import { runMigrations } from "./migrate";
import { assertCatalogSeeded } from "./lib/entitlements";
import { formatSyncReport, syncFeatureRegistry } from "./lib/featureSync";
import { notifyFeaturesAwaitingReview } from "./lib/featureReviewNotice";

const app = express();
app.set("trust proxy", 1);

const isDev = process.env.NODE_ENV !== "production";
app.use(helmet({
  contentSecurityPolicy: isDev ? false : { directives: buildCspDirectives() },
}));
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ limit: "10mb", extended: false }));

// Enforce CSRF protection on state-mutating API requests
app.use(csrfMiddleware);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Route template for per-route telemetry ("GET /api/payroll/periods/:id/entries"). Matched routes use
// their Express pattern; anything unmatched (404s, scanners) is collapsed so ids and junk paths cannot
// blow up the number of distinct keys.
function routeKey(req: Request, path: string): string {
  const pattern = req.route?.path;
  // Most routes are declared with their full "/api/..." pattern; only prefix a router-relative one.
  if (typeof pattern === "string") return `${req.method} ${pattern.startsWith("/api") ? "" : req.baseUrl}${pattern}`;
  return `${req.method} ${path.split("/").slice(0, 3).join("/")}/(unmatched)`;
}

const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_MS || "1000");

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const stats: RequestStats = { queries: 0 };
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  // Only capture the response body in development for debugging — never in production
  if (isDev) {
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      if (path !== "/api/admin/system/health") {
        recordRequest({
          at: Date.now(),
          ms: duration,
          status: res.statusCode,
          method: req.method,
          path,
          businessId: (req as any).user?.businessId,
          route: routeKey(req, path),
          queries: stats.queries,
        });
      }
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (duration >= SLOW_REQUEST_MS) logLine += ` [slow, ${stats.queries} db statements]`;
      if (isDev && capturedJsonResponse) {
        const body = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`;
      }
      log(logLine);
    }
  });

  runWithRequestStats(stats, next);
});

(async () => {
  await runMigrations();
  // Keeps the catalog and flags in step with shared/features.ts on every boot. Safe by construction: it only
  // changes structure, and a priced feature it adds starts inactive, pending an admin's review (see
  // server/lib/featureSync.ts). Set FEATURE_SYNC_ON_BOOT=false to skip it; `npm run features:sync` does it on demand.
  if (process.env.FEATURE_SYNC_ON_BOOT !== "false") {
    try {
      const syncReport = await syncFeatureRegistry();
      log(`feature sync:\n${formatSyncReport(syncReport)}`);
      // Push the "needs your review" notice once, when this boot is the one that added the features.
      if (syncReport.pendingReview.length > 0) {
        notifyFeaturesAwaitingReview(syncReport.pendingReview).catch((error) => console.error("[features] review notice failed:", error));
      }
    } catch (error) {
      console.error("[features] boot sync failed:", error);
    }
  }
  await assertCatalogSeeded();
  startHealthMetricsFlush();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ error: { code: "INTERNAL_ERROR", message } });
    throw err;
  });

  // Production serves the prebuilt static bundle from this same process/port
  // (the only port reachable on the deployment platform - see the port
  // comment below). In development, this process is API-only: the frontend
  // is served by its own standalone Vite dev server (see vite.config.ts's
  // server.proxy and package.json's dev/dev:client/dev:server scripts),
  // which keeps the frontend's HMR connection alive across `tsx watch`
  // restarting this process on every backend file change - it used to run
  // embedded here via server/vite.ts's setupVite, which meant every backend
  // edit also killed the frontend's HMR websocket, forcing a manual browser
  // refresh to see any update (backend or frontend) after most edits.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    // Dev-only safety net: this process no longer serves any frontend route
    // (see the comment above), so a request that lands here for anything
    // other than /api or /ws is almost always someone hitting this port out
    // of habit from before the dev-server split - a bookmark, a hard
    // `window.location.href` redirect (e.g. AdminLogin.tsx after a
    // successful login), or a stale tab. Redirect it to the Vite dev server
    // instead of letting Express's bare "Cannot GET /..." confuse them.
    const viteDevPort = process.env.VITE_DEV_PORT || "5173";
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/ws")) {
        return next();
      }
      res.redirect(`http://localhost:${viteDevPort}${req.originalUrl}`);
    });
  }

  startBookingReminderService();
  startWhatsAppConversationTimeoutSweeper();
  startCreditReminderService();
  startPartnerReminderService();
  startTrialReminderService();
  startFeatureSunsetReminderService();
  startAttendanceDayCloseService();

  // Flush any emails that queued while the server was down (e.g. Render free-tier spin-down)
  const { flushOnStartup } = await import("./services/EmailQueue");
  flushOnStartup();

  const { flushOnStartup: flushWhatsAppOnStartup } = await import("./services/WhatsAppService");
  flushWhatsAppOnStartup();

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
