import { useCallback, useLayoutEffect, useRef } from "react";

// Survives the scroll container unmounting (e.g. the mobile drawer closing).
const offsets = new Map<string, number>();

function readOffset(key: string): number {
  const inMemory = offsets.get(key);
  if (inMemory !== undefined) return inMemory;
  try {
    const stored = Number(sessionStorage.getItem(`scroll:${key}`));
    return Number.isFinite(stored) ? stored : 0;
  } catch {
    return 0;
  }
}

function writeOffset(key: string, value: number) {
  offsets.set(key, value);
  try {
    sessionStorage.setItem(`scroll:${key}`, String(value));
  } catch {
    // storage unavailable; the in-memory copy still works
  }
}

/**
 * Remembers a scroll container's offset under `key` and restores it on mount.
 * Pass `ready=false` while the content is still loading so the offset is
 * applied once the content has its full height.
 */
export function useScrollMemory(key: string, ready = true) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ready && ref.current) ref.current.scrollTop = readOffset(key);
  }, [key, ready]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => writeOffset(key, e.currentTarget.scrollTop),
    [key],
  );

  return { ref, onScroll };
}
