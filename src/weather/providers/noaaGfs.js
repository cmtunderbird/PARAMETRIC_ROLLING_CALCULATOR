// ─── NOAA GFS Weather Provider — Phase 3, Item 19 ────────────────────────────
// Fetches GFS 0.25° wind + MSLP from NOAA NOMADS via local Express bridge.
// No API key required. Data routed through cmems-server.js → cmems_worker.py
// which uses xarray + netCDF4 OPeNDAP for direct NOMADS access.

const PROXY_BASE = "http://localhost:5174";

export const NOAA_SOURCES = {
  "noaa-gfs": {
    name: "NOAA GFS",
    desc: "Global Forecast System 0.25° wind + MSLP (NOMADS)",
    free: true,
    status: "active",
    resolution: "0.25°",
    forecastHours: 384,
    updateCycle: "4x daily (00/06/12/18z)",
  },
  "noaa-wwiii": {
    name: "NOAA WaveWatch III",
    desc: "Global wave model 0.5° Hs/Tp/Dir (NOMADS)",
    free: true,
    status: "planned",
  },
};

// ─── Fetch GFS wind grid for a bounding box ─────────────────────────────────
// Returns array of grid points with windKts, windDir, mslp arrays per point.
// Each point has { lat, lon, times[], windKts[], windDir[], mslp[], source }
export async function fetchNoaaGfs(bounds, forecastHours = 120) {
  const { south, north, west, east } = bounds;
  const url = `${PROXY_BASE}/api/noaa/gfs?south=${south}&north=${north}` +
    `&west=${west}&east=${east}&forecastHours=${forecastHours}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`NOAA GFS: ${body.error || `HTTP ${resp.status}`}`);
  }

  const result = await resp.json();

  // Handle both envelope { ok, data, run } and direct array formats
  if (result.error) throw new Error(`NOAA GFS: ${result.error}`);
  const data = Array.isArray(result) ? result : result.data ?? result;
  if (!Array.isArray(data)) throw new Error("NOAA GFS: unexpected response format");

  return {
    results: data,
    provider: "noaa_gfs",
    run: result.run || null,
    fetchedAt: Date.now(),
  };
}

// ─── Check if the Express bridge is available ────────────────────────────────
export async function isNoaaGfsAvailable() {
  try {
    const resp = await fetch(`${PROXY_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.ok && data.workerReady;
  } catch { return false; }
}

// ─── Fetch for a single point (convenience wrapper) ──────────────────────────
export async function fetchNoaaGfsPoint(lat, lon, forecastHours = 120) {
  // Create a small bounding box around the point (0.5° pad)
  const bounds = {
    south: lat - 0.5, north: lat + 0.5,
    west: lon - 0.5, east: lon + 0.5,
  };
  const { results } = await fetchNoaaGfs(bounds, forecastHours);
  // Return the closest point to the requested lat/lon
  if (!results.length) return null;
  return results.reduce((best, pt) => {
    const d = Math.hypot(pt.lat - lat, pt.lon - lon);
    const db = Math.hypot(best.lat - lat, best.lon - lon);
    return d < db ? pt : best;
  });
}

// ─── WaveWatch III stub (Phase 3, Item 20) ───────────────────────────────────
export async function fetchNoaaWaveWatch(/* bounds, forecastHours */) {
  throw new Error("NOAA WaveWatch III provider not yet implemented (Phase 3, Item 20)");
}
