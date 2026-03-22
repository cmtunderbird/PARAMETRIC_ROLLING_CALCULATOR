// ─── gridInterpolation.js — Unified weather field interpolation ──────────────
// Phase 3, Item 26
// All weather sources deliver on different grids. This module implements
// bilinear spatial + linear temporal interpolation to produce a unified
// weather field along the route at each waypoint's ETA.

/**
 * Bilinear spatial interpolation at a single point from a grid.
 * @param {Array<{lat,lon,...}>} gridPoints — flat array of grid points with data arrays
 * @param {number} lat — target latitude
 * @param {number} lon — target longitude
 * @param {string} field — field name to interpolate (e.g., "waveHeight")
 * @param {number} timeIdx — index into the time array
 * @returns {number|null} — interpolated value
 */
export function bilinearInterpolate(gridPoints, lat, lon, field, timeIdx) {
  if (!gridPoints?.length) return null;

  // Find 4 nearest corners (2 lat × 2 lon)
  const uniqueLats = [...new Set(gridPoints.map(p => p.lat))].sort((a, b) => a - b);
  const uniqueLons = [...new Set(gridPoints.map(p => p.lon))].sort((a, b) => a - b);

  // Find bounding lat/lon indices
  let latLow = 0, latHigh = uniqueLats.length - 1;
  for (let i = 0; i < uniqueLats.length - 1; i++) {
    if (uniqueLats[i] <= lat && uniqueLats[i + 1] >= lat) { latLow = i; latHigh = i + 1; break; }
  }
  let lonLow = 0, lonHigh = uniqueLons.length - 1;
  for (let i = 0; i < uniqueLons.length - 1; i++) {
    if (uniqueLons[i] <= lon && uniqueLons[i + 1] >= lon) { lonLow = i; lonHigh = i + 1; break; }
  }

  const la = uniqueLats[latLow], lb = uniqueLats[latHigh];
  const lo = uniqueLons[lonLow], lp = uniqueLons[lonHigh];

  // Find the 4 corner points
  const getVal = (lt, ln) => {
    const pt = gridPoints.find(p => Math.abs(p.lat - lt) < 0.001 && Math.abs(p.lon - ln) < 0.001);
    if (!pt || !pt[field]) return null;
    const arr = pt[field];
    return Array.isArray(arr) ? arr[timeIdx] : arr;
  };

  const q11 = getVal(la, lo), q12 = getVal(la, lp);
  const q21 = getVal(lb, lo), q22 = getVal(lb, lp);

  // If any corner is missing, use nearest-neighbour fallback
  const corners = [q11, q12, q21, q22].filter(v => v != null && isFinite(v));
  if (corners.length === 0) return null;
  if (corners.length < 4) return corners.reduce((a, b) => a + b, 0) / corners.length;

  // Bilinear weights
  const dLat = lb - la || 1;
  const dLon = lp - lo || 1;
  const tLat = (lat - la) / dLat;
  const tLon = (lon - lo) / dLon;

  return q11 * (1 - tLat) * (1 - tLon) +
         q21 * tLat * (1 - tLon) +
         q12 * (1 - tLat) * tLon +
         q22 * tLat * tLon;
}

/**
 * Linear temporal interpolation between two timesteps.
 */
export function temporalInterpolate(val1, val2, t1, t2, targetTime) {
  if (val1 == null || val2 == null) return val1 ?? val2 ?? null;
  if (t1 === t2) return val1;
  const frac = (targetTime - t1) / (t2 - t1);
  return val1 + (val2 - val1) * Math.max(0, Math.min(1, frac));
}

/**
 * Interpolate a full weather snapshot at a specific lat/lon/time from a grid.
 * Combines bilinear spatial + linear temporal interpolation.
 * @param {Array} gridPoints — grid points with time arrays
 * @param {number} lat — target lat
 * @param {number} lon — target lon
 * @param {number} targetTimeMs — target timestamp in milliseconds
 * @param {string[]} fields — fields to interpolate
 * @returns {Object} — interpolated weather snapshot
 */
export function interpolateSnapshot(gridPoints, lat, lon, targetTimeMs, fields) {
  if (!gridPoints?.length || !gridPoints[0]?.times?.length) return null;

  const times = gridPoints[0].times; // assume all points share the same time array
  // Find bracketing time indices
  let t1Idx = 0, t2Idx = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const t1 = typeof times[i] === "number" && times[i] < 1e12 ? times[i] * 1000 : times[i];
    const t2 = typeof times[i+1] === "number" && times[i+1] < 1e12 ? times[i+1] * 1000 : times[i+1];
    if (t1 <= targetTimeMs && t2 >= targetTimeMs) { t1Idx = i; t2Idx = i + 1; break; }
  }

  const t1Ms = typeof times[t1Idx] === "number" && times[t1Idx] < 1e12 ? times[t1Idx] * 1000 : times[t1Idx];
  const t2Ms = typeof times[t2Idx] === "number" && times[t2Idx] < 1e12 ? times[t2Idx] * 1000 : times[t2Idx];

  const result = { lat, lon, time: targetTimeMs };
  for (const field of fields) {
    const v1 = bilinearInterpolate(gridPoints, lat, lon, field, t1Idx);
    const v2 = bilinearInterpolate(gridPoints, lat, lon, field, t2Idx);
    result[field] = temporalInterpolate(v1, v2, t1Ms, t2Ms, targetTimeMs);
  }
  return result;
}

/**
 * Interpolate weather along an entire voyage route.
 * @param {Array} gridPoints — weather grid data
 * @param {Array<{lat,lon,etaMs}>} waypointsWithETA — voyage waypoints with ETA
 * @param {string[]} fields — fields to interpolate
 * @returns {Array} — weather snapshot per waypoint
 */
export function interpolateAlongRoute(gridPoints, waypointsWithETA, fields = [
  "waveHeight", "wavePeriod", "waveDir", "swellHeight", "swellPeriod", "swellDir",
  "windKts", "windDir", "mslp",
]) {
  if (!gridPoints?.length || !waypointsWithETA?.length) return [];
  return waypointsWithETA.map(wp =>
    interpolateSnapshot(gridPoints, wp.lat, wp.lon, wp.etaMs, fields)
  ).filter(Boolean);
}
