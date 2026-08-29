import { Pool, types } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import fs from "fs";
import path from "path";

// Automatically parse decimal/numeric columns (OID 1700) as numbers
types.setTypeParser(1700, (val: string) => parseFloat(val));

// Force PostgreSQL timestamps (without timezone, OID 1114) to be parsed as UTC
types.setTypeParser(1114, (val: string) => new Date(val + "Z"));

// Manually load .env file if DATABASE_URL is not already in env
if (!process.env.DATABASE_URL) {
  try {
    const envPath = path.resolve(".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      envContent.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.warn("Could not load .env manually:", err);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Session timezone must be UTC to match the OID 1114 parser above, which
// assumes naive "timestamp without time zone" values are already UTC.
// Without this, a server/DB running in a non-UTC zone (e.g. Africa/Lagos)
// stores local wall-clock time in those columns, so appending "Z" on read
// shifts every timestamp by the zone offset (queued emails looked "not due"
// for an extra hour, delaying sends past OTP/reset-code expiry). Set via
// the libpq startup option so it applies before any query can run on the
// connection (a post-connect `SET TIME ZONE` query would race with it).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || "20"),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  options: "-c timezone=UTC",
});

export const db = drizzle(pool, { schema });

// Either the pool-backed `db` or a transaction handle. Lets a repository method
// be called standalone or enlisted into a caller's transaction without the
// method caring which.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
