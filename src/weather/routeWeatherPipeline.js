// ─── routeWeatherPipeline.js — Unified route weather fetch ──────────────────
// Single-action pipeline: synoptic grid + voyage weather in one coordinated flow.
// Ensures model coherence: if NOAA WW3 is used for marine, NOAA GFS is used for
// wind (same model family). Never mixes Open-Meteo marine with NOAA wind.
//
// Progress callback reports through all stages:
//   1. Calculate voyage ETAs
//   2. Probe data sources (which are available?)
//   3. Fetch marine grid (synoptic overlay)
//   4. Fetch wind grid (same model family as marine)
//   5. Fetch voyage weather (interpolate at each WP's ETA)
//   6. Compute seakeeping motions along route

import { buildGridPoints, fetchMarineGrid, fetchAtmosphericGrid,
         fetchMarineUnified, fetchCmemsPhysicsGrid } from "../weatherApi.js";
import { isNoaaGfsAvailable, fetchNoaaGfs,
         fetchNoaaWaveWatch } from "./providers/noaaGfs.js";
import { fetchOpenMeteo } from "./providers/openMeteo.js";
import { cacheGet, cacheSet, cacheStatus, cacheInvalidate } from "../weatherCache.js";
import { sanitizeWxSnapshot } from "../weatherValidation.js";
import { closestHourIdx, calcVoyageETAs, cumulativeDistances } from "../core/voyageEngine.js";
import { generateWeatherSamplePoints } from "../RouteParser.js";
import { calcMotions, getMotionStatus } from "../physics.js";

// ─── Model family coherence table ───────────────────────────────────────────
// If marine comes from source X, wind MUST come from the corresponding source
const MODEL_FAMILIES = {
  noaa:     { marine: "noaa_wwiii", wind: "noaa_gfs",   label: "NOAA (WW3 + GFS)" },
  openmeteo:{ marine: "openmeteo",  wind: "openmeteo",  label: "Open-Meteo (ICON + GFS Seamless)" },
  cmems:    { marine: "cmems",      wind: "openmeteo",  label: "CMEMS (wave) + Open-Meteo (wind)" },
};

// ─── Probe available sources and select best coherent family ────────────────
async function selectModelFamily(cmemsCredentials, providerPref = "auto") {
  const bridgeUp = await isNoaaGfsAvailable().catch(() => false);

  // Explicit NOAA selection
  if (providerPref === "noaa") {
    if (bridgeUp) return { ...MODEL_FAMILIES.noaa, bridgeUp: true };
    // Bridge not available — fall back with warning
    return { ...MODEL_FAMILIES.openmeteo, bridgeUp: false,
      warning: "NOAA selected but Express bridge offline — using Open-Meteo" };
  }
  // Explicit CMEMS selection
  if (providerPref === "cmems" && cmemsCredentials?.user && cmemsCredentials?.pass) {
    return { ...MODEL_FAMILIES.cmems, bridgeUp };
  }
  // Explicit Open-Meteo selection
  if (providerPref === "openmeteo") {
    return { ...MODEL_FAMILIES.openmeteo, bridgeUp };
  }
  // Auto: NOAA (free, hi-res, coherent) → CMEMS (if creds) → Open-Meteo
  if (bridgeUp) return { ...MODEL_FAMILIES.noaa, bridgeUp: true };
  if (cmemsCredentials?.user && cmemsCredentials?.pass)
    return { ...MODEL_FAMILIES.cmems, bridgeUp: false };
  return { ...MODEL_FAMILIES.openmeteo, bridgeUp: false };
}

// ─── Main unified pipeline ──────────────────────────────────────────────────
/**
 * Single-action route weather fetch. Call once, get everything.
 *
 * @param {Object} params
 * @param {Array} params.waypoints — route waypoints [{lat, lon, ...}]
 * @param {string} params.bospDT — BOSP datetime ISO string
 * @param {number} params.voyageSpeed — planned speed in knots
 * @param {Object} params.shipParams — {Lwl, B, GM, Tr, rollDamping, ...}
 * @param {Object} params.mapBounds — {south, north, west, east} for synoptic grid
 * @param {number} params.gridRes — synoptic grid resolution (degrees)
 * @param {boolean} params.showAtmo — include wind overlay
 * @param {boolean} params.showCurrents — include CMEMS currents
 * @param {Object} params.cmemsCredentials — {user, pass} or null
 * @param {string} params.cmemsProvider — "auto"|"noaa"|"cmems"|"openmeteo"
 * @param {boolean} params.forceRefresh — bypass cache
 * @param {function} params.onProgress — (stage, pct, detail) callback
 * @returns {Promise<Object>} — { voyageWPs, voyageWeather, marineGrid, atmoGrid,
 *                                 physicsGrid, modelFamily, log }
 */
export async function fetchRouteWeather({
  waypoints, bospDT, voyageSpeed, shipParams,
  mapBounds, gridRes = 2.0, showAtmo = true, showCurrents = false,
  cmemsCredentials = null, cmemsProvider = "auto",
  forceRefresh = false, onProgress = () => {},
}) {
  const log = [];
  const t0 = Date.now();
  let totalStages = 5; // ETA + probe + marine + wind + voyage
  let completedStages = 0;
  const progress = (stage, detail) => {
    completedStages++;
    const pct = Math.round((completedStages / totalStages) * 100);
    onProgress(stage, pct, detail);
    log.push({ stage, detail, elapsed: Date.now() - t0 });
  };

  // ═══ STAGE 1: Calculate voyage ETAs ═══
  onProgress("Calculating voyage ETAs...", 5, "");
  const bospMs = new Date(bospDT + 'Z').getTime(); // explicit UTC
  const voyageWPs = calcVoyageETAs(waypoints, bospMs, voyageSpeed);
  progress("voyage_etas", `${voyageWPs.length} waypoints`);

  // ═══ STAGE 2: Probe sources & select coherent model family ═══
  onProgress("Probing data sources...", 10, "");
  const family = await selectModelFamily(cmemsCredentials, cmemsProvider);
  if (showCurrents && family.bridgeUp) totalStages++;
  progress("source_probe", family.label);

  // ═══ STAGE 3: Build synoptic grid ═══
  // ═══ STAGE 3: Build synoptic grid ═══
  // Grid point cap depends on source: NOAA OPeNDAP is a single bbox request
  // (can handle large grids), Open-Meteo is batched (10pts/request, rate limited).
  const maxPts = family.marine === "noaa_wwiii" || family.marine === "noaa_gfs" ? 600 : 80;
  let effectiveGridRes = gridRes;
  let gridPts, gridBounds;
  if (mapBounds) {
    ({ points: gridPts, bounds: gridBounds } = buildGridPoints(mapBounds, effectiveGridRes));
    while (gridPts.length > maxPts && effectiveGridRes < 8.0) {
      effectiveGridRes = parseFloat((effectiveGridRes + 0.25).toFixed(2));
      ({ points: gridPts, bounds: gridBounds } = buildGridPoints(mapBounds, effectiveGridRes));
    }
    if (gridPts.length > 2000) throw new Error(`Grid too large (${gridPts.length} pts). Zoom in or increase resolution.`);
  }
  if (forceRefresh && gridBounds) {
    cacheInvalidate("marine", gridBounds, effectiveGridRes);
    cacheInvalidate("atmo", gridBounds, effectiveGridRes);
  }

  // ═══ STAGE 3: Fetch marine grid (synoptic overlay) ═══
  // Source-aware: use NOAA WW3 when bridge is up, else fall back to old path
  let marineGrid = null;
  if (gridPts && gridBounds) {
    onProgress("Fetching marine data...", 20, `${family.label} — ${gridPts.length} grid points`);
    try {
      if (family.marine === "noaa_wwiii" && family.bridgeUp) {
        // ── NOAA WaveWatch III via OPeNDAP (single bbox request) ──
        // WW3 native grid is 0.5° — set gridRes to match for correct overlay rendering
        const wwResult = await fetchNoaaWaveWatch(gridBounds, 120);
        const nativeRes = 0.5; // WW3 native resolution
        marineGrid = { results: wwResult.results, gridRes: nativeRes,
          bounds: gridBounds, provider: "noaa_wwiii", fromCache: false,
          fetchedAt: Date.now(), run: wwResult.run };
      } else {
        // ── Fallback: CMEMS → Open-Meteo via old unified path ──
        const creds = cmemsCredentials?.user ? cmemsCredentials : null;
        const mResult = await fetchMarineUnified(gridPts, 7, gridBounds, effectiveGridRes,
          cmemsProvider, creds);
        marineGrid = { results: mResult.results, gridRes: effectiveGridRes,
          bounds: gridBounds, provider: mResult.provider || "openmeteo",
          fromCache: mResult.fromCache, fetchedAt: mResult.fetchedAt };
      }
    } catch (e) {
      log.push({ stage: "marine_grid", error: e.message });
      // If NOAA failed, try Open-Meteo as fallback
      if (family.marine === "noaa_wwiii") {
        try {
          log.push({ stage: "marine_grid_fallback", detail: "NOAA failed, trying Open-Meteo" });
          const mResult = await fetchMarineUnified(gridPts, 7, gridBounds, effectiveGridRes,
            "openmeteo", null);
          marineGrid = { results: mResult.results, gridRes: effectiveGridRes,
            bounds: gridBounds, provider: mResult.provider || "openmeteo",
            fromCache: mResult.fromCache, fetchedAt: mResult.fetchedAt };
        } catch (e2) {
          log.push({ stage: "marine_grid_fallback", error: e2.message });
        }
      }
    }
  }
  progress("marine_grid", marineGrid
    ? `${marineGrid.results?.length} pts (${marineGrid.provider}${marineGrid.run ? " " + marineGrid.run : ""})`
    : "skipped");

  // ═══ STAGE 4: Fetch wind grid (SAME model family as marine) ═══
  let atmoGrid = null;
  if (showAtmo && gridPts && gridBounds) {
    const windSource = marineGrid?.provider === "cmems" ? "openmeteo"
      : marineGrid?.provider === "noaa_wwiii" || family.marine === "noaa_wwiii" ? "noaa_gfs"
      : "openmeteo";
    onProgress("Fetching wind data...", 40, `Source: ${windSource}`);
    try {
      if (windSource === "noaa_gfs" && family.bridgeUp) {
        const gfsResult = await fetchNoaaGfs(gridBounds, 120);
        atmoGrid = { results: gfsResult.results, gridRes: 0.25,
          bounds: gridBounds, provider: "noaa_gfs", run: gfsResult.run };
      } else {
        const aResult = await fetchAtmosphericGrid(gridPts, 7, gridBounds, effectiveGridRes);
        atmoGrid = { results: aResult.results, gridRes: effectiveGridRes,
          bounds: gridBounds, provider: aResult.provider || "openmeteo" };
      }
    } catch (e) {
      log.push({ stage: "wind_grid", error: e.message });
      // ── FALLBACK: if NOAA GFS failed, try Open-Meteo for wind ──
      if (windSource === "noaa_gfs") {
        onProgress("GFS wind failed — falling back to Open-Meteo...", 45, e.message);
        try {
          const aResult = await fetchAtmosphericGrid(gridPts, 7, gridBounds, effectiveGridRes);
          atmoGrid = { results: aResult.results, gridRes: effectiveGridRes,
            bounds: gridBounds, provider: "openmeteo_fallback" };
          log.push({ stage: "wind_grid_fallback", detail: "Open-Meteo wind OK" });
        } catch (e2) {
          log.push({ stage: "wind_grid_fallback", error: e2.message });
        }
      }
    }
  }
  progress("wind_grid", atmoGrid ? `${atmoGrid.results?.length} pts (${atmoGrid.provider})` : "NO WIND DATA");

  // ═══ STAGE 4b: CMEMS currents (optional) ═══
  // Use TIGHT route corridor bounds (not full map viewport) to avoid timeout
  // on the high-resolution (0.083°) GLORYS physics grid.
  let physicsGrid = null;
  if (showCurrents && cmemsCredentials?.user && gridBounds) {
    // Build tight route corridor bounds with 0.5° padding
    const routeLats = waypoints.map(w => w.lat);
    const routeLons = waypoints.map(w => w.lon);
    const routeBounds = {
      south: Math.min(...routeLats) - 0.5,
      north: Math.max(...routeLats) + 0.5,
      west:  Math.min(...routeLons) - 0.5,
      east:  Math.max(...routeLons) + 0.5,
    };
    onProgress("Fetching ocean currents...", 55, "CMEMS GLORYS (route corridor)");
    try {
      const phyResult = await fetchCmemsPhysicsGrid(
        cmemsCredentials.user, cmemsCredentials.pass, gridPts, routeBounds, 0.083);
      physicsGrid = { results: phyResult.results, gridRes: 0.083, bounds: routeBounds };
      const phyCount = Array.isArray(phyResult.results) ? phyResult.results.length : 0;
      const sample = phyCount > 0 ? phyResult.results[0] : null;
      console.log(`[Pipeline] Physics grid: ${phyCount} pts`,
        sample ? `sample: lat=${sample.lat} lon=${sample.lon} times=${sample.times?.length} currentSpeed=${sample.currentSpeed?.slice(0,3)}` : "no data");
      progress("currents", `${phyCount} pts`);
    } catch (e) {
      log.push({ stage: "currents", error: e.message });
      onProgress("Currents unavailable (continuing)...", 58, e.message.includes("timeout") ? "First CMEMS connection takes ~2min — retry later" : e.message);
    }
  }

  // ═══ STAGE 5: Voyage weather — interpolate at each WP's ETA ═══
  onProgress("Computing voyage weather...", 65, `${voyageWPs.length} waypoints`);
  let voyageWeather = null;
  if (voyageWPs?.length && route_has_weather(marineGrid)) {
    try {
      const pts = generateWeatherSamplePoints(waypoints, 150);
      const totalNM = voyageWPs[voyageWPs.length - 1].cumNM || 1;
      const eospMs = bospMs + (totalNM / voyageSpeed) * 3600000;
      const cumDists = cumulativeDistances(pts);
      const totalPtNM = cumDists[cumDists.length - 1] || 1;
      const ptsWithETA = pts.map((p, i) => ({
        ...p, etaMs: bospMs + (cumDists[i] / totalPtNM) * (eospMs - bospMs),
      }));

      // De-duplicate sample points
      const uniq = [], seen = new Set();
      for (const p of ptsWithETA) {
        const k = `${(p.lat||0).toFixed(1)},${(p.lon||0).toFixed(1)}`;
        if (!seen.has(k)) { seen.add(k); uniq.push(p); }
      }

      // Use the SAME marine/atmo data already fetched for coherence
      // Nearest-neighbour lookup (NOAA grid is 0.25-0.5°, route points are arbitrary)
      const mResults = marineGrid?.results ?? [];
      const aResults = atmoGrid?.results ?? [];

      function findNearest(results, lat, lon) {
        if (!results.length) return null;
        let best = null, bestDist = Infinity;
        for (const r of results) {
          const d = (r.lat - lat) ** 2 + (r.lon - lon) ** 2;
          if (d < bestDist) { bestDist = d; best = r; }
        }
        return best;
      }

      onProgress("Computing seakeeping motions...", 80, "");
      let _phyLogDone = false;
      voyageWeather = ptsWithETA.map(p => {
        const mr = findNearest(mResults, p.lat, p.lon);
        const ar = findNearest(aResults, p.lat, p.lon);
        const pr = physicsGrid?.results?.length ? findNearest(physicsGrid.results, p.lat, p.lon) : null;
        const mIdx = mr ? closestHourIdx(mr.times, p.etaMs) : 0;
        const aIdx = ar ? closestHourIdx(ar.times, p.etaMs) : 0;
        const pIdx = pr ? closestHourIdx(pr.times, p.etaMs) : 0;
        if (!_phyLogDone) {
          console.log(`[Pipeline] Current interp: grid=${physicsGrid?.results?.length||0}pts, nearest=${pr?`(${pr.lat},${pr.lon})`:'null'}`,
            pr ? `spd[${pIdx}]=${pr.currentSpeed?.[pIdx]} dir[${pIdx}]=${pr.currentDir?.[pIdx]}` : '');
          _phyLogDone = true;
        }
        const weather = mr ? {
          waveHeight: mr.waveHeight?.[mIdx], waveDir: mr.waveDir?.[mIdx],
          wavePeriod: mr.wavePeriod?.[mIdx],
          swellHeight: mr.swellHeight?.[mIdx], swellPeriod: mr.swellPeriod?.[mIdx],
          swellDir: mr.swellDir?.[mIdx],
          windKts: ar?.windKts?.[aIdx], windDir: ar?.windDir?.[aIdx],
          mslp: ar?.mslp?.[aIdx],
          currentSpeed: pr?.currentSpeed?.[pIdx] ?? null,
          currentDir: pr?.currentDir?.[pIdx] ?? null,
        } : null;
        const safeWeather = weather ? sanitizeWxSnapshot(weather) : null;
        const motions = safeWeather ? calcMotions({
          waveHeight_m: safeWeather.waveHeight || 0,
          wavePeriod_s: safeWeather.wavePeriod || 8,
          waveDir_deg: safeWeather.waveDir || p.heading || 0,
          swellHeight_m: safeWeather.swellHeight || 0,
          swellPeriod_s: safeWeather.swellPeriod || 10,
          swellDir_deg: safeWeather.swellDir || 0,
          heading_deg: p.heading || 0, speed_kts: voyageSpeed,
          Lwl: shipParams?.Lwl || 200, B: shipParams?.B || 32,
          GM: shipParams?.GM || 2.5, Tr: shipParams?.Tr || 14,
          rollDamping: shipParams?.rollDamping ?? 0.05,
        }) : null;
        const motionStatus = motions
          ? getMotionStatus(motions, weather?.waveHeight || 0, weather?.windKts || 0) : null;
        return { ...p, weather, motions, motionStatus,
          riskSeverity: motionStatus?.severity ?? 0 };
      });
    } catch (e) {
      log.push({ stage: "voyage_weather", error: e.message });
    }
  }
  progress("voyage_weather", voyageWeather ? `${voyageWeather.length} pts` : "no marine data");

  // ═══ DONE ═══
  onProgress("Complete", 100, `${family.label} — ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  return {
    voyageWPs,
    voyageWeather,
    marineGrid,
    atmoGrid,
    physicsGrid,
    modelFamily: family,
    log,
    elapsed: Date.now() - t0,
  };
}

// Helper: check if we have marine data to work with
function route_has_weather(marineGrid) {
  return marineGrid?.results?.length > 0;
}
