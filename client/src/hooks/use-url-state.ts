import { useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { useLocation } from "wouter";

/**
 * Like useState, but persists the value to a URL query param under `key`, so it survives
 * navigating to a detail page and back (or a page refresh) instead of resetting to
 * `defaultValue`. Reads the initial value from the URL on first render.
 */
export function useUrlState<T extends string | number>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T = (raw) => raw as unknown as T,
): [T, Dispatch<SetStateAction<T>>] {
  const [location, setLocation] = useLocation();

  const [value, setValue] = useState<T>(() => {
    const raw = new URLSearchParams(window.location.search).get(key);
    return raw !== null ? parse(raw) : defaultValue;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
    const nextSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (nextSearch !== currentSearch) {
      setLocation(nextSearch ? `${location}?${nextSearch}` : location, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}
