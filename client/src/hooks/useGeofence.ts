import { useCallback, useEffect, useRef, useState } from "react";
import { haversineMeters } from "@shared/geo";

export type GeofenceCentre = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
};

export type GeofenceState =
  | "idle"          // nothing to measure against yet
  | "unsupported"   // browser has no geolocation
  | "insecure"      // not an https origin, so the browser will refuse
  | "denied"        // permission refused
  | "locating"      // waiting for a first fix
  | "weak"          // got a fix, but too vague to prove the radius either way
  | "inside"
  | "outside";

export type GeofenceReading = {
  state: GeofenceState;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  latitude: number | null;
  longitude: number | null;
  error: string | null;
  /** Browser's own error (code + message), shown for support diagnostics. */
  rawError: string | null;
  refresh: () => void;
};

/**
 * Watches the device's position and reports where it stands relative to the
 * branch. Used only to decide whether the clock-in button is enabled — the server
 * recomputes the same distance from the coordinates in the payload, so a client
 * that lies about being inside still gets a 403.
 *
 * "weak" is deliberately separate from "outside". A fix reporting ±80 m of error
 * cannot prove a 50 m radius either way, and telling somebody standing in the
 * salon that they are somewhere else is how the fallback path becomes the daily
 * path.
 */
export function useGeofence(centre: GeofenceCentre | null, enabled: boolean): GeofenceReading {
  const [state, setState] = useState<GeofenceState>("idle");
  const [distanceMeters, setDistance] = useState<number | null>(null);
  const [accuracyMeters, setAccuracy] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rawError, setRawError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const stateRef = useRef<GeofenceState>("idle");
  stateRef.current = state;

  // watchPosition ends for good on its first PERMISSION_DENIED, so somebody who
  // dismisses the prompt and then allows location in site settings would stay
  // stuck on "denied" until they found the retry button. Restart the watch as
  // soon as the permission flips, or when they come back to the tab.
  useEffect(() => {
    if (!enabled || !centre) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => { if (stateRef.current === "denied") refresh(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") onChange();
    };
    try {
      navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener("change", onChange);
      }).catch(() => {});
    } catch { /* Permissions API unavailable (older Safari) — focus fallback below */ }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onChange);
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onChange);
    };
  }, [enabled, !!centre, refresh]);

  useEffect(() => {
    if (!enabled || !centre) {
      setState("idle");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unsupported");
      setError("This browser cannot report your location.");
      return;
    }
    if (!window.isSecureContext) {
      setState("insecure");
      setError("Clocking in needs a secure (https) connection.");
      return;
    }

    setState("locating");
    setError(null);

    const onPosition = (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setCoords({ latitude, longitude });
      setAccuracy(accuracy);
      setError(null);

      const distance = haversineMeters(
        { latitude: centre.latitude, longitude: centre.longitude },
        { latitude, longitude },
      );
      setDistance(distance);

      if (accuracy > centre.maxAccuracyMeters) {
        setState("weak");
        return;
      }
      setState(distance <= centre.radiusMeters ? "inside" : "outside");
    };

    const onError = (err: GeolocationPositionError) => {
      setRawError(`code ${err.code}${err.message ? `: ${err.message}` : ""}`);
      if (err.code === err.PERMISSION_DENIED) {
        setState("denied");
        setError("Location permission is off. Turn it on for this site to clock in.");
        return;
      }
      setState("weak");
      setError("Could not get a location fix. Move near a window or step outside.");
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    });

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, centre?.latitude, centre?.longitude, centre?.radiusMeters, centre?.maxAccuracyMeters, nonce]);

  return {
    state,
    distanceMeters,
    accuracyMeters,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    error,
    rawError,
    refresh,
  };
}
