/**
 * A stable-ish identifier for this browser, sent with every clock-in punch.
 *
 * The point is not to be unforgeable — nothing in a browser is. The point is that
 * clocking in five colleagues from one phone leaves five punches carrying the same
 * id, which a manager can then see. A geofence cannot catch that case at all,
 * because everyone involved genuinely is at the salon.
 *
 * Expected to churn: private browsing, cleared site data, and iOS evicting storage
 * after a week of not using the site all produce a fresh id. That is why an
 * unrecognised device is flagged for review rather than blocked.
 */

const STORAGE_KEY = "bm_device_id";

export function getDeviceId(): string | null {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Storage blocked entirely (some privacy modes). The punch still goes
    // through; it simply carries no device identity.
    return null;
  }
}

/** A per-punch idempotency key, so an offline replay cannot double-punch. */
export function newPunchId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `punch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
