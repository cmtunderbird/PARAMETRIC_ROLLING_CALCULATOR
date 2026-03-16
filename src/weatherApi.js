// ─── weatherApi.js ─────────────────────────────────────────────────────────────
// Unified weather fetch — Open-Meteo (free) + CMEMS (optional, with credentials)
// Rate-limit safe: batch ≤10, 1.5s inter-batch, exponential backoff on 429/5xx,
// sequential marine→atmospheric (never parallel), global fetch semaphore.

import { cacheGet, cacheSet } from "./weatherCache.js";
import { cmemsWaveGrid, cmemsPhysicsGrid } from "./cmemsProvider.js";

// ── Global semaphore — max 2 Open-Meteo requests in flight at a time ─────────
// 2-concurrent gives ~2x speed vs 1-concurrent while staying well within
// free-tier rate limits (~80 req/min vs 40 req/min — limit is ~600/min).
let _omActive = 0;
const _omQueue = [];
const OM_CONCURRENT = 2;

function omAcquire() {
  return new Promise(resolve => {
    if (_omActive < OM_CONCURRENT) { _omActive++; resolve(); }
    else _omQueue.push(resolve);
  });
}
function omRelease() {
  _omActive--;
  const next = _omQueue.shift();
  if (next) { _omActive++; next(); }
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const BATCH       = 10;     // Open-Meteo free tier: ≤10 locations per request
const BATCH_DELAY = 1500;   // ms between batches  (40 req/min = 1.5s safe floor)
const MAX_RETRIES = 4;      // retry attempts on 429 / 5xx

// ── Fetch with retry + exponential backoff ─────────────────────────────────────
async function fetchWithRetry(url, attempt = 0) {
  await omAcquire();
  try {
    const resp = await fetch(url);
    if (resp.status === 429 || resp.status >= 500) {
      const retryAfter = parseInt(resp.headers.get("Retry-After") || "0", 10);
      const backoff = retryAfter > 0
        ? retryAfter * 1000
        : Math.min(2000 * Math.pow(2, attempt), 30000); // 2s, 4s, 8s, 16s, cap 30s
      if (attempt < MAX_RETRIES) {
        omRelease();
        await delay(backoff);
        return fetchWithRetry(url, attempt + 1);
      }
      throw new Error(`HTTP ${resp.status} after ${MAX_RETRIES} retries`);
    }
    const json = await resp.json();
    await delay(200); // courtesy pause after each successful request
    return json;
  } finally {
    omRelease();
  }
}

// ── Grid builder ──────────────────────────────────────────────────────────────
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

// ── Progress callback helper ──────────────────────────────────────────────────
// onProgress(done, total) called after each batch
async function _batchFetch(points, buildUrl, parseResult, onProgress) {
  const results = [];
  const total = Math.ceil(points.length / BATCH);
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH);
    try {
      const data = await fetchWithRetry(buildUrl(batch));
      const arr  = Array.isArray(data) ? data : [data];
      arr.forEach((r, j) => parseResult(r, batch[j], results));
    } catch(e) {
      batch.forEach(p => results.push({ ...p, error: e.message }));
    }
    if (onProgress) onProgress(batchNum + 1, total);
    if (i + BATCH < points.length) await delay(BATCH_DELAY);
  }
  return results;
}

// ── Open-Meteo Marine (free vars only — no premium ocean currents) ─────────────
// Wave decomposition matches windmar: combined + wind-wave + swell components
async function _fetchMarineRaw(points, forecastDays = 7, onProgress) {
  const vars = [
    "wave_height","wave_direction","wave_period",
    "wind_wave_height","wind_wave_period","wind_wave_direction",
    "swell_wave_height","swell_wave_period","swell_wave_direction",
  ].join(",");
  return _batchFetch(points,
    batch => `https://marine-api.open-meteo.com/v1/marine?latitude=${
      batch.map(p=>p.lat).join(",")}&longitude=${
      batch.map(p=>p.lon).join(",")}&hourly=${vars}&forecast_days=${forecastDays}&timeformat=unixtime`,
    (r, pt, out) => {
      if (!r.hourly) { out.push({ ...pt, error: r.reason||"no data" }); return; }
      const h = r.hourly;
      out.push({ ...pt, times: h.time, source: "openmeteo",
        waveHeight:  h.wave_height,       waveDir:     h.wave_direction,   wavePeriod:  h.wave_period,
        windWaveH:   h.wind_wave_height,  windWaveT:   h.wind_wave_period, windWaveDir: h.wind_wave_direction,
        swellHeight: h.swell_wave_height, swellPeriod: h.swell_wave_period,swellDir:    h.swell_wave_direction,
      });
    },
    onProgress
  );
}

// ── Open-Meteo Atmospheric (GFS Seamless — same source as windmar GFS) ─────────
async function _fetchAtmoRaw(points, forecastDays = 7, onProgress) {
  return _batchFetch(points,
    batch => `https://api.open-meteo.com/v1/forecast?latitude=${
      batch.map(p=>p.lat).join(",")}&longitude=${
      batch.map(p=>p.lon).join(",")}&hourly=wind_speed_10m,wind_direction_10m,pressure_msl` +
      `&forecast_days=${forecastDays}&wind_speed_unit=kn&timeformat=unixtime&models=gfs_seamless`,
    (r, pt, out) => {
      if (!r.hourly) { out.push({ ...pt, error: r.reason||"no data" }); return; }
      const h = r.hourly;
      out.push({ ...pt, times: h.time, source: "gfs",
        windKts: h.wind_speed_10m, windDir: h.wind_direction_10m, mslp: h.pressure_msl });
    },
    onProgress
  );
}

// ── Public cached fetchers ────────────────────────────────────────────────────
export async function fetchMarineGrid(points, forecastDays=7, bounds=null, gridRes=2.0, onProgress) {
  if (bounds) {
    const cached = cacheGet("marine", bounds, gridRes);
    if (cached) {
      const ageMin = Math.round((Date.now()-cached.fetchedAt)/60000);
      return { results:cached.results, fromCache:true, fetchedAt:cached.fetchedAt, cacheAgeMin:ageMin, provider:"openmeteo" };
    }
  }
  const results = await _fetchMarineRaw(points, forecastDays, onProgress);
  if (bounds) cacheSet("marine", bounds, gridRes, results);
  return { results, fromCache:false, fetchedAt:Date.now(), cacheAgeMin:0, provider:"openmeteo" };
}

export async function fetchAtmosphericGrid(points, forecastDays=7, bounds=null, gridRes=2.0, onProgress) {
  if (bounds) {
    const cached = cacheGet("atmo", bounds, gridRes);
    if (cached) {
      const ageMin = Math.round((Date.now()-cached.fetchedAt)/60000);
      return { results:cached.results, fromCache:true, fetchedAt:cached.fetchedAt, cacheAgeMin:ageMin, provider:"gfs" };
    }
  }
  const results = await _fetchAtmoRaw(points, forecastDays, onProgress);
  if (bounds) cacheSet("atmo", bounds, gridRes, results);
  return { results, fromCache:false, fetchedAt:Date.now(), cacheAgeMin:0, provider:"gfs" };
}

export async function fetchCmemsMarineGrid(user, pass, points, forecastDays=7, bounds=null, gridRes=0.083) {
  if (bounds) {
    const cached = cacheGet("marine_cmems", bounds, gridRes);
    if (cached) {
      const ageMin = Math.round((Date.now()-cached.fetchedAt)/60000);
      return { results:cached.results, fromCache:true, fetchedAt:cached.fetchedAt, cacheAgeMin:ageMin, provider:"cmems" };
    }
  }
  const results = await cmemsWaveGrid(user, pass, bounds||{south:-80,north:90,west:-180,east:180}, forecastDays);
  if (bounds) cacheSet("marine_cmems", bounds, gridRes, results);
  return { results, fromCache:false, fetchedAt:Date.now(), cacheAgeMin:0, provider:"cmems" };
}

export async function fetchCmemsPhysicsGrid(user, pass, points, bounds=null, gridRes=0.083) {
  if (bounds) {
    const cached = cacheGet("physics_cmems", bounds, gridRes);
    if (cached) {
      const ageMin = Math.round((Date.now()-cached.fetchedAt)/60000);
      return { results:cached.results, fromCache:true, fetchedAt:cached.fetchedAt, cacheAgeMin:ageMin, provider:"cmems_phy" };
    }
  }
  const results = await cmemsPhysicsGrid(user, pass, bounds||{south:-80,north:90,west:-180,east:180}, 2);
  if (bounds) cacheSet("physics_cmems", bounds, gridRes, results);
  return { results, fromCache:false, fetchedAt:Date.now(), cacheAgeMin:0, provider:"cmems_phy" };
}

// ── Unified marine (CMEMS → Open-Meteo fallback) ──────────────────────────────
export async function fetchMarineUnified(points, forecastDays=7, bounds=null, gridRes=2.0,
                                          provider="openmeteo", cmemsCredentials=null, onProgress) {
  if ((provider==="cmems"||provider==="auto") && cmemsCredentials?.user && cmemsCredentials?.pass) {
    try {
      return await fetchCmemsMarineGrid(cmemsCredentials.user, cmemsCredentials.pass,
        points, forecastDays, bounds, 0.083);
    } catch(e) {
      if (provider==="cmems") throw e;
      console.warn("CMEMS failed, falling back to Open-Meteo:", e.message);
    }
  }
  return fetchMarineGrid(points, forecastDays, bounds, gridRes, onProgress);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function closestHourIdx(times_unix, targetMs) {
  if (!times_unix?.length) return 0;
  return times_unix.reduce((best, t, k) =>
    Math.abs(t*1000-targetMs) < Math.abs(times_unix[best]*1000-targetMs) ? k : best, 0);
}

// snapshotAt — internal helper, not exported (unused outside weatherApi.js)
function snapshotAt(pt, hourIdx) {
  if (!pt || pt.error) return null;
  const g = (arr) => arr?.[hourIdx] ?? null;
  return {
    lat: pt.lat, lon: pt.lon, source: pt.source,
    waveHeight:  g(pt.waveHeight),  waveDir:     g(pt.waveDir),    wavePeriod:  g(pt.wavePeriod),
    windWaveH:   g(pt.windWaveH),   windWaveT:   g(pt.windWaveT),  windWaveDir: g(pt.windWaveDir),
    swellHeight: g(pt.swellHeight), swellPeriod: g(pt.swellPeriod),swellDir:    g(pt.swellDir),
    currentSpeed:g(pt.currentSpeed),currentDir:  g(pt.currentDir),
    currentU:    g(pt.currentU),    currentV:    g(pt.currentV),   sst: g(pt.sst),
    windKts:     g(pt.windKts),     windDir:     g(pt.windDir),    mslp: g(pt.mslp),
  };
}

export function calcVoyageETAs(waypoints, bospTimeMs, speedKts) {
  if (!waypoints?.length || speedKts <= 0) return [];
  let cumNM = 0;
  return waypoints.map((wp, i) => {
    if (i === 0) return { ...wp, cumNM: 0, etaMs: bospTimeMs };
    const prev = waypoints[i-1];
    const dLat = (wp.lat-prev.lat)*Math.PI/180, dLon = (wp.lon-prev.lon)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(prev.lat*Math.PI/180)*Math.cos(wp.lat*Math.PI/180)*Math.sin(dLon/2)**2;
    cumNM += 3440.065 * 2 * Math.asin(Math.sqrt(a));
    return { ...wp, cumNM, etaMs: bospTimeMs+(cumNM/speedKts)*3600000, legNM: cumNM };
  });
}
