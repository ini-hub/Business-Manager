import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Integration tests — the ones that need a real Postgres.
 *
 * Deliberately a SEPARATE config and a separate file suffix (`.itest.ts`) so
 * `npm test` stays fast, hermetic and runnable anywhere, while these run only
 * when someone has provisioned a throwaway database and asked for them.
 *
 * The hard rule enforced below: they run against TEST_DATABASE_URL and nothing
 * else. These tests create stores, staff, sales and payroll runs, and settle
 * real debt — pointing them at the working database would corrupt live books.
 * `server/db.ts` reads DATABASE_URL at import time, so the only reliable way to
 * redirect it is to overwrite that variable for the test environment before any
 * test module loads, which is what `test.env` does.
 */

function readEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const envPath = path.resolve(__dirname, ".env");
    if (!fs.existsSync(envPath)) return out;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[trimmed.slice(0, eq).trim()] = val;
    }
  } catch {
    /* fall through to whatever is already in process.env */
  }
  return out;
}

const fileEnv = readEnvFile();
const testUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
const liveUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;

if (!testUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set.\n\n" +
    "Integration tests write real rows — stores, staff, sales, payroll runs — so\n" +
    "they refuse to run without a database provisioned specifically for throwing\n" +
    "away. Create an empty database and set TEST_DATABASE_URL (in .env or the\n" +
    "environment), e.g.\n\n" +
    "  createdb business_manager_test\n" +
    "  TEST_DATABASE_URL=postgres://localhost/business_manager_test npm run test:integration\n"
  );
}

// The guard that matters. A typo that points TEST_DATABASE_URL at the working
// database would let the suite truncate live books, so refuse the exact match.
if (liveUrl && testUrl === liveUrl) {
  throw new Error(
    "TEST_DATABASE_URL is identical to DATABASE_URL.\n\n" +
    "These tests delete the data they create and would destroy real records.\n" +
    "Point TEST_DATABASE_URL at a separate, disposable database."
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.itest.ts"],
    env: {
      // server/db.ts builds its pool from DATABASE_URL at import time.
      DATABASE_URL: testUrl,
      NODE_ENV: "test",
      // Importing `storage` pulls in server/auth.ts, which throws at module
      // load unless these are present. Deliberately dummies rather than the
      // real values from .env: nothing here signs a token that leaves the
      // process, and a test run has no business holding production secrets.
      JWT_SECRET: "integration-test-jwt-secret-not-a-real-key",
      SESSION_SECRET: "integration-test-session-secret-not-a-real-key",
    },
    // Real Postgres round-trips, plus a schema migration on first run.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The pg pool is a module singleton shared across files. Running files in
    // parallel would let one file's cleanup delete another's fixtures.
    fileParallelism: false,
  },
});
