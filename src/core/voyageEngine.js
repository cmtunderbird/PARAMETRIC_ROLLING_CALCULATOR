// ─── voyageEngine.js — Voyage ETA calculation and route utilities ────────────
// Extracted from weatherApi.js — Phase 1, Item 5
// Supports per-leg speeds and configurable BOSP/EOSP waypoint indices.

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
// Supports per-leg speeds and configurable BOSP/EOSP indices.
//
// @param {Array}  waypoints    — route waypoints [{lat, lon, name, ...}]
// @param {number} bospTimeMs   — BOSP departure time (ms since epoch)
// @param {number} defaultSpeed — default speed in knots (fallback)
// @param {Object} opts
//   opts.bospIdx   — index of BOSP waypoint (default 0)
//   opts.eospIdx   — index of EOSP waypoint (default last)
//   opts.legSpeeds — {[legIndex]: speed} per-leg speed overrides
//
// Returns waypoints annotated with cumNM, legNM, etaMs, heading, legSpeed.
// Waypoints before BOSP or after EOSP get etaMs = null (outside passage).
export function calcVoyageETAs(waypoints, bospTimeMs, defaultSpeed, opts = {}) {
  if (!waypoints?.length || defaultSpeed <= 0) return [];
  const bospIdx = opts.bospIdx ?? 0;
  const eospIdx = opts.eospIdx ?? (waypoints.length - 1);
  const legSpeeds = opts.legSpeeds || {};

  let cumNM = 0;
  let cumTimeMs = 0;

  return waypoints.map((wp, i) => {
    const nextWp = waypoints[i + 1];
    const prevWp = i > 0 ? waypoints[i - 1] : null;

    // Heading: course TO this WP from previous (or to next if first)
    const heading = prevWp
      ? calcBearing(prevWp.lat, prevWp.lon, wp.lat, wp.lon)
      : nextWp ? calcBearing(wp.lat, wp.lon, nextWp.lat, nextWp.lon) : 0;

    // Before BOSP or after EOSP — outside sea passage
    if (i < bospIdx || i > eospIdx) {
      return { ...wp, cumNM: 0, legNM: 0, etaMs: null, heading, legSpeed: null, inPassage: false };
    }

    // BOSP waypoint
    if (i === bospIdx) {
      cumNM = 0;
      cumTimeMs = 0;
      return { ...wp, cumNM: 0, legNM: 0, etaMs: bospTimeMs, heading,
               legSpeed: legSpeeds[i] ?? defaultSpeed, inPassage: true };
    }

    // In-passage waypoint: compute leg distance and time
    const legDist = haversineNM(prevWp.lat, prevWp.lon, wp.lat, wp.lon);
    // Use per-leg speed for the leg FROM previous WP TO this WP
    // legSpeeds keyed by the index of the WP the leg departs FROM
    const speed = legSpeeds[i - 1] ?? defaultSpeed;
    cumNM += legDist;
    cumTimeMs += (legDist / speed) * 3600000;

    return {
      ...wp, cumNM, legNM: legDist, heading,
      etaMs: bospTimeMs + cumTimeMs,
      legSpeed: speed,
      inPassage: i <= eospIdx,
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
