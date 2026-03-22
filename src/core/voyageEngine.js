// ─── voyageEngine.js — Voyage ETA calculation and route utilities ────────────
// Extracted from weatherApi.js — Phase 1, Item 5
// Fixes the legNM bug: was set to cumulative NM, now set to individual leg distance.

// ── Haversine distance (NM) between two points ─────────────────────────────
export function haversineNM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}

// ── Find the closest forecast hour index to a target timestamp ──────────────
export function closestHourIdx(times_unix, targetMs) {
  if (!times_unix?.length) return 0;
  return times_unix.reduce((best, t, k) =>
    Math.abs(t * 1000 - targetMs) < Math.abs(times_unix[best] * 1000 - targetMs) ? k : best, 0);
}

// ── Calculate voyage ETAs for each waypoint ─────────────────────────────────
// Given waypoints, BOSP time, and speed, returns waypoints annotated with:
//   cumNM  — cumulative distance from BOSP
//   legNM  — distance of this individual leg (FIXED: was incorrectly set to cumNM)
//   etaMs  — estimated time of arrival in milliseconds
//   heading — course to next waypoint (degrees true)
export function calcVoyageETAs(waypoints, bospTimeMs, speedKts) {
  if (!waypoints?.length || speedKts <= 0) return [];
  let cumNM = 0;
  return waypoints.map((wp, i) => {
    if (i === 0) {
      // BOSP — compute heading to next WP
      const nextWp = waypoints[1];
      const heading = nextWp ? calcBearing(wp.lat, wp.lon, nextWp.lat, nextWp.lon) : 0;
      return { ...wp, cumNM: 0, legNM: 0, etaMs: bospTimeMs, heading };
    }
    const prev = waypoints[i - 1];
    const legDist = haversineNM(prev.lat, prev.lon, wp.lat, wp.lon);
    cumNM += legDist;
    // Heading: use course TO this waypoint from previous
    const heading = calcBearing(prev.lat, prev.lon, wp.lat, wp.lon);
    return {
      ...wp,
      cumNM,
      legNM: legDist,  // BUG FIX: was `cumNM` (cumulative), now individual leg distance
      etaMs: bospTimeMs + (cumNM / speedKts) * 3600000,
      heading,
    };
  });
}

// ── Initial bearing (degrees true) from point A to point B ──────────────────
export function calcBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const la1 = lat1 * Math.PI / 180;
  const la2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ── Cumulative distances for an array of sample points ──────────────────────
// Used by RouteChart.jsx for ETA interpolation along sampled route points
export function cumulativeDistances(points) {
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(dists[i - 1] + haversineNM(
      points[i - 1].lat, points[i - 1].lon,
      points[i].lat, points[i].lon
    ));
  }
  return dists;
}
