import { pool } from "../db";

/**
 * Runs `fn` only if no other instance is already running the same job.
 *
 * The background services (reminders, queues, sweeps) run inside every web
 * process and select-then-send. With two instances they would send duplicates;
 * a session-level Postgres advisory lock, held on one pooled connection for the
 * whole run, makes the second instance skip that tick. A crashed holder frees
 * the lock when its connection drops. Returns undefined when it was skipped.
 */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS got", [`job:${name}`]);
    locked = rows[0]?.got === true;
    if (!locked) return undefined;
    return await fn();
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`job:${name}`]).catch(() => undefined);
    client.release();
  }
}
