// ─── weatherApi.js ─────────────────────────────────────────────────────────────
// Unified Open-Meteo fetch utilities — Marine + Forecast APIs (free, no key)
// All grid fetches are backed by weatherCache.js (localStorage persistence).
// Cache auto-invalidates on staleness (marine 6h, atmo 3h) or area change.

import { cacheGet, cacheSet } from "./weatherCache.js";

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH = 40;

// ── Build flat grid of lat/lon points from map bounds + resolution ─────────────
export function buildGridPoints(bounds, gridRes) {
  const { south, north, west, east } = bounds;
  const s = Math.floor(south / gridRes) * gridRes;
  const n = Math.ceil(north  / gridRes) * gridRes;
  const w = Math.floor(west  / gridRes) * gridRes;
  const e = Math.ceil(east   / gridRes) * gridRes;
  const pts = [];
  for (let la = s; la <= n + 0.001; la += gridRes)
    for (let lo = w; lo <= e + 0.001; lo += gridRes)
      pts.push({ lat: parseFloat(la.toFixed(2)), lon: parseFloat(lo.toFixed(2)) });
  return { points: pts, bounds: { south:s, north:n, west:w, east:e } };
}

// ── Raw Marine fetch (no cache) ───────────────────────────────────────────────
async function _fetchMarineRaw(points, forecastDays = 7) {
  const results = [];
  for (let i = 0; i < points.length; i += BATCH) {
    if (i > 0) await delay(350);
    const batch = points.slice(i, i + BATCH);
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${
      batch.map(p => p.lat).join(',')}&longitude=${
      batch.map(p => p.lon).join(',')}&hourly=wave_height,wave_direction,wave_period,` +
      `swell_wave_height,swell_wave_period,swell_wave_direction&forecast_days=${forecastDays}&timeformat=unixtime`;
    try {
      const d = await (await fetch(url)).json();
      const arr = Array.isArray(d) ? d : [d];
      arr.forEach((r, j) => {
        if (!r.hourly) { results.push({ ...batch[j], error: r.reason||'no data' }); return; }
        const h = r.hourly;
        results.push({ ...batch[j], times: h.time,
          waveHeight: h.wave_height, waveDir: h.wave_direction, wavePeriod: h.wave_period,
          swellHeight: h.swell_wave_height, swellPeriod: h.swell_wave_period, swellDir: h.swell_wave_direction });
      });
    } catch(e) { batch.forEach(p => results.push({ ...p, error: e.message })); }
  }
  return results;
}

// ── Raw Atmospheric fetch (no cache) ─────────────────────────────────────────
async function _fetchAtmoRaw(points, forecastDays = 7) {
  const results = [];
  for (let i = 0; i < points.length; i += BATCH) {
    if (i > 0) await delay(350);
    const batch = points.slice(i, i + BATCH);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${
      batch.map(p => p.lat).join(',')}&longitude=${
      batch.map(p => p.lon).join(',')}&hourly=wind_speed_10m,wind_direction_10m,pressure_msl` +
      `&forecast_days=${forecastDays}&wind_speed_unit=kn&timeformat=unixtime`;
    try {
      const d = await (await fetch(url)).json();
      const arr = Array.isArray(d) ? d : [d];
      arr.forEach((r, j) => {
        if (!r.hourly) { results.push({ ...batch[j], error: r.reason||'no data' }); return; }
        const h = r.hourly;
        results.push({ ...batch[j], times: h.time,
          windKts: h.wind_speed_10m, windDir: h.wind_direction_10m, mslp: h.pressure_msl });
      });
    } catch(e) { batch.forEach(p => results.push({ ...p, error: e.message })); }
  }
  return results;
}

// ── Cached Marine fetch ───────────────────────────────────────────────────────
// Returns { results, fromCache, fetchedAt, cacheAgeMin }
export async function fetchMarineGrid(points, forecastDays = 7, bounds = null, gridRes = 2.0) {
  if (bounds) {
    const cached = cacheGet("marine", bounds, gridRes);
    if (cached) {
      const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60000);
      return { results: cached.results, fromCache: true, fetchedAt: cached.fetchedAt, cacheAgeMin: ageMin };
    }
  }
  const results = await _fetchMarineRaw(points, forecastDays);
  if (bounds) cacheSet("marine", bounds, gridRes, results);
  return { results, fromCache: false, fetchedAt: Date.now(), cacheAgeMin: 0 };
}

// ── Cached Atmospheric fetch ──────────────────────────────────────────────────
export async function fetchAtmosphericGrid(points, forecastDays = 7, bounds = null, gridRes = 2.0) {
  if (bounds) {
    const cached = cacheGet("atmo", bounds, gridRes);
    if (cached) {
      const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60000);
      return { results: cached.results, fromCache: true, fetchedAt: cached.fetchedAt, cacheAgeMin: ageMin };
    }
  }
  const results = await _fetchAtmoRaw(points, forecastDays);
  if (bounds) cacheSet("atmo", bounds, gridRes, results);
  return { results, fromCache: false, fetchedAt: Date.now(), cacheAgeMin: 0 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function closestHourIdx(times_unix, targetMs) {
  if (!times_unix?.length) return 0;
  return times_unix.reduce((best, t, k) =>
    Math.abs(t * 1000 - targetMs) < Math.abs(times_unix[best] * 1000 - targetMs) ? k : best, 0);
}

export function snapshotAt(gridResult, hourIdx) {
  if (!gridResult || gridResult.error) return null;
  return {
    lat: gridResult.lat, lon: gridResult.lon,
    waveHeight: gridResult.waveHeight?.[hourIdx]  ?? null,
    waveDir:    gridResult.waveDir?.[hourIdx]      ?? null,
    wavePeriod: gridResult.wavePeriod?.[hourIdx]   ?? null,
    swellHeight: gridResult.swellHeight?.[hourIdx] ?? null,
    swellPeriod: gridResult.swellPeriod?.[hourIdx] ?? null,
    swellDir:   gridResult.swellDir?.[hourIdx]     ?? null,
    windKts:    gridResult.windKts?.[hourIdx]      ?? null,
    windDir:    gridResult.windDir?.[hourIdx]       ?? null,
    mslp:       gridResult.mslp?.[hourIdx]         ?? null,
  };
}

export function calcVoyageETAs(waypoints, bospTimeMs, speedKts) {
  if (!waypoints?.length || speedKts <= 0) return [];
  let cumNM = 0;
  return waypoints.map((wp, i) => {
    if (i === 0) return { ...wp, cumNM: 0, etaMs: bospTimeMs };
    const prev = waypoints[i - 1];
    const dLat = (wp.lat - prev.lat) * Math.PI / 180;
    const dLon = (wp.lon - prev.lon) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(prev.lat*Math.PI/180)*Math.cos(wp.lat*Math.PI/180)*Math.sin(dLon/2)**2;
    cumNM += 3440.065 * 2 * Math.asin(Math.sqrt(a));
    return { ...wp, cumNM, etaMs: bospTimeMs + (cumNM / speedKts) * 3600000, legNM: cumNM };
  });
}
