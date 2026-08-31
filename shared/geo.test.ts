import { describe, it, expect } from "vitest";
import { haversineMeters, isValidLatitude, isValidLongitude } from "./geo";

// A salon in Lagos, and points a known distance away.
const salon = { latitude: 6.524379, longitude: 3.379206 };

/** Offsets a point due north by metres, using the standard 111,320 m per degree. */
const northOf = (from: typeof salon, metres: number) => ({
  latitude: from.latitude + metres / 111_320,
  longitude: from.longitude,
});

describe("haversineMeters", () => {
  it("returns zero for identical points", () => {
    expect(haversineMeters(salon, { ...salon })).toBe(0);
  });

  it("resolves either side of a 50 m geofence", () => {
    // The whole feature turns on this boundary, so it is asserted directly.
    expect(haversineMeters(salon, northOf(salon, 49))).toBeLessThan(50);
    expect(haversineMeters(salon, northOf(salon, 51))).toBeGreaterThan(50);
  });

  it("is accurate to within a metre at geofence scale", () => {
    expect(haversineMeters(salon, northOf(salon, 100))).toBeCloseTo(100, 0);
  });

  it("is symmetric", () => {
    const a = haversineMeters(salon, northOf(salon, 250));
    const b = haversineMeters(northOf(salon, 250), salon);
    expect(a).toBeCloseTo(b, 6);
  });

  it("takes the short way across the antimeridian", () => {
    // Naive longitude subtraction would report most of the way around the planet.
    const west = { latitude: 0, longitude: 179.999 };
    const east = { latitude: 0, longitude: -179.999 };
    expect(haversineMeters(west, east)).toBeLessThan(500);
  });

  it("handles polar coordinates without blowing up", () => {
    // Both points are the north pole; only floating-point residue separates them.
    const d = haversineMeters({ latitude: 90, longitude: 0 }, { latitude: 90, longitude: 180 });
    expect(d).toBeCloseTo(0, 6);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe("coordinate validation", () => {
  it("accepts in-range values and rejects everything else", () => {
    expect(isValidLatitude(6.5)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude("6.5")).toBe(false);
    expect(isValidLongitude(-179.9)).toBe(true);
    expect(isValidLongitude(181)).toBe(false);
  });
});
