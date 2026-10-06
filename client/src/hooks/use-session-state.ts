import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

function read<T>(key: string, fallback: T, revive?: (raw: unknown) => T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return revive ? revive(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Like useState, but mirrors the value to sessionStorage under `key` so it survives navigation and refresh. */
export function useSessionState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => read(key, defaultValue));
  useEffect(() => write(key, value), [key, value]);
  return [value, setValue];
}

/** useSessionState for a Set<string> (e.g. collapsed sections). */
export function useSessionSet(key: string): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [value, setValue] = useState<Set<string>>(() =>
    read(key, new Set<string>(), (raw) => new Set(Array.isArray(raw) ? raw.map(String) : [])),
  );
  useEffect(() => write(key, Array.from(value)), [key, value]);
  return [value, setValue];
}
