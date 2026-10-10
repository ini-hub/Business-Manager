import { useEffect, useState } from "react";

/**
 * False on the first render, true once the browser is idle (or after `fallbackMs`). Gate low-priority
 * queries (notification badge, announcements) on it so they don't compete with the shell's critical
 * requests; on a slow link that ordering is the difference between a usable page now and in several seconds.
 */
export function useAfterFirstPaint(fallbackMs = 1500): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: { timeout: number }) => number);
    if (ric) {
      const id = ric(() => setReady(true), { timeout: fallbackMs });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, [fallbackMs]);
  return ready;
}
