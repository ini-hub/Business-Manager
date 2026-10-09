/**
 * A counting semaphore: at most `max` holders at once, the rest wait in arrival order.
 *
 * Used to stop one kind of expensive work from taking the whole database connection pool. A dashboard that fires a
 * dozen queries at once queues behind the cap instead of holding every connection and starving ordinary requests.
 */
export interface Semaphore {
  /** Waits for a slot and resolves with a function that gives it back (safe to call more than once). */
  acquire(): Promise<() => void>;
  /** Runs `fn` while holding a slot. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

export function createSemaphore(max: number): Semaphore {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const queue: Array<() => void> = [];

  const grant = (): (() => void) => {
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      const next = queue.shift();
      if (next) next();
    };
  };

  const acquire = (): Promise<() => void> =>
    new Promise((resolve) => {
      if (active < limit) resolve(grant());
      else queue.push(() => resolve(grant()));
    });

  return {
    acquire,
    async run(fn) {
      const release = await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}

/** One semaphore per key (for example per user), created on first use and dropped when idle. */
export function createKeyedSemaphore(maxPerKey: number) {
  const slots = new Map<string, Semaphore>();
  return {
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      let slot = slots.get(key);
      if (!slot) slots.set(key, (slot = createSemaphore(maxPerKey)));
      try {
        return await slot.run(fn);
      } finally {
        if (slot.active === 0 && slot.waiting === 0) slots.delete(key);
      }
    },
  };
}
