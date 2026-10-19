// Distances and speeds between two places, for the impossible travel and
// location mismatch rules (docs/adr/0011). City-level data is coarse: each
// place's accuracy radius is subtracted first, so noise never pages anyone.

const EARTH_RADIUS_KM = 6371.0088;

export interface Place {
  latitude: number;
  longitude: number;
  /** How far the true place may be from these coordinates. */
  accuracyKm: number;
}

/** Great-circle distance (haversine), in km. */
export function distanceKm(a: Place, b: Place): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The distance that is certain: the accuracy radii of both places taken off. */
export function certainDistanceKm(a: Place, b: Place): number {
  return Math.max(0, distanceKm(a, b) - a.accuracyKm - b.accuracyKm);
}

/**
 * The speed needed to be at both places at those times, in km/h; undefined
 * when they are too close in time to tell (`minSeconds`).
 */
export function travelSpeedKmh(
  from: Place & { at: Date },
  to: Place & { at: Date },
  minSeconds: number,
): number | undefined {
  const seconds = Math.abs(to.at.getTime() - from.at.getTime()) / 1000;
  if (seconds < minSeconds) return undefined;
  return certainDistanceKm(from, to) / (seconds / 3600);
}
