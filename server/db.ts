import "./lib/loadEnv";
import { Pool, types } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import { installQueryCounter } from "./lib/queryCounter";

// Automatically parse decimal/numeric columns (OID 1700) as numbers
types.setTypeParser(1700, (val: string) => parseFloat(val));

// Force PostgreSQL timestamps (without timezone, OID 1114) to be parsed as UTC
types.setTypeParser(1114, (val: string) => new Date(val + "Z"));

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
// Managed Postgres providers (Neon, Supabase, Render, etc.) require TLS.
// Their certs chain to a public CA already in Node's default trust store, so
// full verification (rejectUnauthorized: true, the pg default when `ssl` is
// set) works without pinning anything - confirmed against this project's own
// Neon endpoint. Local/self-hosted Postgres (127.0.0.1, localhost) never
// asks for TLS, so only enable it when the URL says so.
const requiresSsl =
  /\bsslmode=require\b/.test(process.env.DATABASE_URL) ||
  /\.neon\.tech\b/.test(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || "10"),
  idleTimeoutMillis: 5 * 60_000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || "20000"),
  // Keep a couple of TLS connections warm and TCP-alive: a cold connect to a
  // remote Neon endpoint costs ~4s, which stacks up when a page load fires many
  // parallel API calls.
  min: parseInt(process.env.DB_POOL_MIN || "2"),
  keepAlive: true,
  options: "-c timezone=UTC",
  ssl: requiresSsl ? { rejectUnauthorized: true } : undefined,
});

// An idle pooled connection dropped by Neon/pooler emits 'error' on the pool;
// with no listener that would crash the process. pg-pool discards the client.
pool.on("error", (err) => console.warn("[db] idle client error:", err.message));

installQueryCounter(pool);

export const db = drizzle(pool, { schema });

// A new connection to a remote Neon endpoint can take 4-15s (TLS + pooler
// handshake over a long path); queries on an established one take ~0.3s. So
// open `min` connections up front and keep them exercised, otherwise the first
// burst of requests after idle each pays the handshake, and any that exceed the
// connect timeout surface as "Connection terminated due to connection timeout".
// pg-pool's own `min` only stops idle eviction; it never opens connections.
const warmTarget = Math.max(0, parseInt(process.env.DB_POOL_MIN || "2"));
async function warmPool(): Promise<void> {
  // Each client is warmed independently. pg-pool detaches its own 'error'
  // listener while a client is checked out, so a connection that Neon drops
  // between checkout and the query would emit an unhandled 'error' and take the
  // process down; attach a listener for the duration of the checkout and
  // release(err) so the pool discards a dead client instead of reusing it.
  await Promise.allSettled(
    Array.from({ length: warmTarget }, async () => {
      const client = await pool.connect();
      let failure: Error | undefined;
      const onError = (err: Error) => {
        failure = err;
        console.warn("[db] warm client error:", err.message);
      };
      client.on("error", onError);
      try {
        await client.query("select 1");
      } catch (err) {
        failure = err as Error;
      } finally {
        client.removeListener("error", onError);
        client.release(failure);
      }
    }),
  );
}
if (warmTarget > 0 && process.env.NODE_ENV !== "test") {
  void warmPool();
  setInterval(() => void warmPool(), 60_000).unref();
}

// Either the pool-backed `db` or a transaction handle. Lets a repository method
// be called standalone or enlisted into a caller's transaction without the
// method caring which.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
