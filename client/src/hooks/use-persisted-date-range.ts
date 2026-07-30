import { useEffect, useState } from "react";

export interface StoredRange {
  from: Date | undefined;
  to: Date | undefined;
}

/** Reads a date range previously saved by `usePersistedDateRange`, or null if none/invalid. */
export function readPersistedRange(storageKey: string): StoredRange | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const range = {
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };
    return range.from || range.to ? range : null;
  } catch {
    return null;
  }
}

/**
 * Like `useState`, but persists the date range to sessionStorage under
 * `storageKey` on every change so it survives navigating away and back.
 * Pass an initializer that checks `readPersistedRange(storageKey)` (after any
 * page-specific URL deep-link handling) as its fallback.
 */
export function usePersistedDateRange<T extends StoredRange | undefined>(
  storageKey: string,
  initializer: () => T,
): [T, (range: T) => void] {
  const [dateRange, setDateRange] = useState<T>(initializer);

  useEffect(() => {
    if (!dateRange || (!dateRange.from && !dateRange.to)) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, JSON.stringify(dateRange));
  }, [storageKey, dateRange]);

  return [dateRange, setDateRange];
}
