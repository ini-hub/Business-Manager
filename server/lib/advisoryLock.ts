import { pool } from "../db";

/**
 * Runs `fn` only if no other instance is already running the same job.
 *
 * The background services (reminders, queues, sweeps) run inside every web
 * process and select-then-send. With two instances they would send duplicates;
 * a transaction-level Postgres advisory lock, held for the whole run, makes
 * the second instance skip that tick. A crashed holder frees the lock when its
 * connection drops. Returns undefined when it was skipped.
 *
 * Transaction-level (not session-level) on purpose: the database sits behind
 * a transaction-mode pooler, where a session lock can be taken on one backend
 * and "unlocked" on another, leaking the lock forever and silently stalling
 * the job (the email queue stopped sending this way). The enclosing
 * transaction pins one backend and the lock is released by COMMIT/ROLLBACK.
 */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS got", [`job:${name}`]);
    if (rows[0]?.got !== true) {
      await client.query("ROLLBACK");
      return undefined;
    }
    try {
      return await fn();
    } finally {
      await client.query("COMMIT").catch(() => undefined);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
