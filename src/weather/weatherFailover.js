// ─── weatherFailover.js — Automatic provider failover chain ──────────────────
// Phase 3, Item 22
// Implements: CMEMS → NOAA WW3 → NOAA GFS → Open-Meteo → cached → manual entry
// Each provider has a health check. When one fails, the next is tried automatically.
// Logs which provider served each data point for audit trail.

import { fetchOpenMeteo, OPEN_METEO_SOURCES } from "./providers/openMeteo.js";
import { fetchNoaaGfs, fetchNoaaWaveWatch, isNoaaGfsAvailable } from "./providers/noaaGfs.js";
import { cacheGet, cacheSet } from "../weatherCache.js";

// ── Provider health state ───────────────────────────────────────────────────
const health = {
  cmems:       { ok: true, lastCheck: 0, failures: 0 },
  noaa_wwiii:  { ok: true, lastCheck: 0, failures: 0 },
  noaa_gfs:    { ok: true, lastCheck: 0, failures: 0 },
  openmeteo:   { ok: true, lastCheck: 0, failures: 0 },
};

function markOk(provider) {
  health[provider].ok = true;
  health[provider].failures = 0;
  health[provider].lastCheck = Date.now();
}
function markFail(provider) {
  health[provider].failures++;
  if (health[provider].failures >= 3) health[provider].ok = false;
  health[provider].lastCheck = Date.now();
}

/** Reset a provider's health (e.g., after user re-enables it) */
export function resetProviderHealth(provider) {
  if (health[provider]) { health[provider].ok = true; health[provider].failures = 0; }
}

/** Get current health status of all providers */
export function getProviderHealth() {
  return { ...health };
}

// ── Marine data failover chain ──────────────────────────────────────────────
// Priority: NOAA WW3 → Open-Meteo Marine → cached
// (CMEMS handled separately since it needs credentials)
export async function fetchMarineWithFailover(lat, lon, {
  bounds = null, gridRes = 2.0, forecastDays = 7,
  cmemsCredentials = null, onProviderUsed = null,
} = {}) {
  const ptBounds = bounds || { south: lat - 1, north: lat + 1, west: lon - 1, east: lon + 1 };
  const log = [];

  // 1. Try NOAA WaveWatch III (if bridge available)
  if (health.noaa_wwiii.ok) {
    try {
      const bridgeUp = await isNoaaGfsAvailable();
      if (bridgeUp) {
        const result = await fetchNoaaWaveWatch(ptBounds, forecastDays * 24);
        markOk("noaa_wwiii");
        log.push({ provider: "noaa_wwiii", status: "ok", run: result.run });
        if (onProviderUsed) onProviderUsed("noaa_wwiii", result.run);
        return { data: result.results, provider: "noaa_wwiii", log, fromCache: false };
      }
    } catch (e) {
      markFail("noaa_wwiii");
      log.push({ provider: "noaa_wwiii", status: "fail", error: e.message });
    }
  }

  // 2. Try Open-Meteo Marine (always available, no bridge needed)
  if (health.openmeteo.ok) {
    try {
      const cached = cacheGet("marine", ptBounds, gridRes);
      if (cached) {
        log.push({ provider: "openmeteo", status: "cached" });
        if (onProviderUsed) onProviderUsed("openmeteo_cached");
        return { data: cached.results, provider: "openmeteo", log, fromCache: true,
          cacheAge: Math.round((Date.now() - cached.fetchedAt) / 60000) };
      }
      const data = await fetchOpenMeteo("open-meteo-marine", lat, lon, forecastDays);
      cacheSet("marine", ptBounds, gridRes, [data]);
      markOk("openmeteo");
      log.push({ provider: "openmeteo", status: "ok" });
      if (onProviderUsed) onProviderUsed("openmeteo");
      return { data: [data], provider: "openmeteo", log, fromCache: false };
    } catch (e) {
      markFail("openmeteo");
      log.push({ provider: "openmeteo", status: "fail", error: e.message });
    }
  }

  // 3. Try any cached data (even stale)
  const anyCached = cacheGet("marine", ptBounds, gridRes);
  if (anyCached) {
    log.push({ provider: "cache_stale", status: "fallback" });
    if (onProviderUsed) onProviderUsed("cache_stale");
    return { data: anyCached.results, provider: "cache_stale", log, fromCache: true,
      cacheAge: Math.round((Date.now() - anyCached.fetchedAt) / 60000) };
  }

  // 4. All failed — return null (caller shows manual entry mode)
  log.push({ provider: "none", status: "all_failed" });
  return { data: null, provider: null, log, fromCache: false };
}

// ── Atmospheric/wind data failover chain ────────────────────────────────────
// Priority: NOAA GFS → Open-Meteo Weather → cached
export async function fetchWindWithFailover(lat, lon, {
  bounds = null, gridRes = 2.0, forecastDays = 7, onProviderUsed = null,
} = {}) {
  const ptBounds = bounds || { south: lat - 1, north: lat + 1, west: lon - 1, east: lon + 1 };
  const log = [];

  // 1. Try NOAA GFS
  if (health.noaa_gfs.ok) {
    try {
      const bridgeUp = await isNoaaGfsAvailable();
      if (bridgeUp) {
        const result = await fetchNoaaGfs(ptBounds, forecastDays * 24);
        markOk("noaa_gfs");
        log.push({ provider: "noaa_gfs", status: "ok", run: result.run });
        if (onProviderUsed) onProviderUsed("noaa_gfs", result.run);
        return { data: result.results, provider: "noaa_gfs", log, fromCache: false };
      }
    } catch (e) {
      markFail("noaa_gfs");
      log.push({ provider: "noaa_gfs", status: "fail", error: e.message });
    }
  }

  // 2. Try Open-Meteo Weather
  if (health.openmeteo.ok) {
    try {
      const cached = cacheGet("atmo", ptBounds, gridRes);
      if (cached) {
        log.push({ provider: "openmeteo", status: "cached" });
        if (onProviderUsed) onProviderUsed("openmeteo_cached");
        return { data: cached.results, provider: "openmeteo", log, fromCache: true,
          cacheAge: Math.round((Date.now() - cached.fetchedAt) / 60000) };
      }
      await new Promise(r => setTimeout(r, 1200)); // rate-limit gap
      const data = await fetchOpenMeteo("open-meteo-weather", lat, lon, forecastDays);
      cacheSet("atmo", ptBounds, gridRes, [data]);
      markOk("openmeteo");
      log.push({ provider: "openmeteo", status: "ok" });
      if (onProviderUsed) onProviderUsed("openmeteo");
      return { data: [data], provider: "openmeteo", log, fromCache: false };
    } catch (e) {
      markFail("openmeteo");
      log.push({ provider: "openmeteo", status: "fail", error: e.message });
    }
  }

  // 3. Stale cache fallback
  const anyCached = cacheGet("atmo", ptBounds, gridRes);
  if (anyCached) {
    log.push({ provider: "cache_stale", status: "fallback" });
    return { data: anyCached.results, provider: "cache_stale", log, fromCache: true,
      cacheAge: Math.round((Date.now() - anyCached.fetchedAt) / 60000) };
  }

  return { data: null, provider: null, log, fromCache: false };
}

// ── Combined fetch with full failover ───────────────────────────────────────
// Returns { marine, wind, providers, log } — caller gets whatever data is available
export async function fetchAllWithFailover(lat, lon, options = {}) {
  const [marineResult, windResult] = await Promise.allSettled([
    fetchMarineWithFailover(lat, lon, options),
    fetchWindWithFailover(lat, lon, options),
  ]);

  const marine = marineResult.status === "fulfilled" ? marineResult.value : { data: null, log: [] };
  const wind = windResult.status === "fulfilled" ? windResult.value : { data: null, log: [] };

  return {
    marine: marine.data?.[0] ?? null,  // first result for single-point
    wind: wind.data?.[0] ?? null,
    marineProvider: marine.provider,
    windProvider: wind.provider,
    marineFromCache: marine.fromCache,
    windFromCache: wind.fromCache,
    log: [...(marine.log || []), ...(wind.log || [])],
  };
}
