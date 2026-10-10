import { useLayoutEffect, useState } from "react";

function read(key: string): number {
  try {
    return Number(sessionStorage.getItem(`scroll:${key}`)) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: number) {
  try {
    sessionStorage.setItem(`scroll:${key}`, String(value));
  } catch {}
}

/**
 * Remembers a scroll container's offset under `key` (sessionStorage) and restores it whenever the
 * element mounts, so it survives navigation, refresh and a drawer that unmounts when closed.
 *
 * Returns a callback ref: pass it as the container's `ref`. `ready=false` holds off until the content
 * is loaded. Same approach as the admin layout's per-route scroll: retry until the content is tall
 * enough, and don't record the offset while restoring (a clamped 0 would overwrite it).
 */
export function useScrollMemory(key: string, ready = true) {
  const [el, setEl] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!el || !ready) return;
    const target = read(key);
    let restoring = target > 0;
    let attempts = 0;
    let frame = 0;
    const restore = () => {
      if (!restoring) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) <= 1 || ++attempts > 40) {
        restoring = false;
        return;
      }
      frame = requestAnimationFrame(restore);
    };
    restore();
    const onScroll = () => {
      if (!restoring) write(key, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [el, key, ready]);

  return setEl;
}
