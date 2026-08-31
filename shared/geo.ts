/**
 * Geospatial helpers shared by client and server.
 *
 * Deliberately in `shared/` rather than duplicated: the client enables the clock-in
 * button from this distance and the server re-validates the punch with it. Two
 * implementations would eventually drift into a button that is enabled while the
 * server returns 403.
 */

export type LatLng = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METRES = 6_371_008.8; // IUGG mean radius

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres between two points.
 *
 * Haversine rather than a planar approximation because the latter degrades badly
 * near the poles, and rather than Vincenty because at salon-geofence scale (tens of
 * metres) the ellipsoidal correction is far below GPS noise.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}
