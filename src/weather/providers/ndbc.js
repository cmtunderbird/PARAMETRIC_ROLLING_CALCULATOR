// ─── ndbc.js — NDBC buoy real-time observations ─────────────────────────────
// Phase 3, Item 21
// Fetches real-time buoy observations from NDBC (ndbc.noaa.gov).
// Parse in JavaScript — no Python worker needed.
// Displays as point observations on chart. When near a route waypoint,
// compares forecast vs observed to show forecast accuracy.

const NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2";

// ── Key NDBC buoys for major shipping routes ────────────────────────────────
export const NDBC_BUOYS = {
  // North Atlantic
  "44066": { name: "Texas Tower #4", lat: 39.618, lon: -72.644, region: "N Atlantic" },
  "41048": { name: "West Bermuda", lat: 31.978, lon: -69.649, region: "N Atlantic" },
  "41049": { name: "South Bermuda", lat: 27.490, lon: -63.000, region: "N Atlantic" },
  "44011": { name: "Georges Bank", lat: 41.088, lon: -66.589, region: "NW Atlantic" },
  "44025": { name: "Long Island", lat: 40.251, lon: -73.164, region: "NW Atlantic" },
  // North Pacific
  "46001": { name: "Gulf of Alaska", lat: 56.300, lon: -148.021, region: "N Pacific" },
  "46005": { name: "Washington Offshore", lat: 46.100, lon: -131.017, region: "NE Pacific" },
  "46006": { name: "SE Papa", lat: 40.801, lon: -137.381, region: "NE Pacific" },
  "51000": { name: "N Hawaii", lat: 23.546, lon: -153.913, region: "Central Pacific" },
  // Gulf of Mexico
  "42001": { name: "Mid Gulf", lat: 25.888, lon: -89.668, region: "Gulf of Mexico" },
  "42002": { name: "W Gulf", lat: 25.790, lon: -93.666, region: "Gulf of Mexico" },
};

// ── Parse NDBC standard meteorological data (*.txt format) ──────────────────
// Format: space-delimited columns with 2-line header
function parseNdbcTxt(text, buoyId) {
  const lines = text.trim().split("\n");
  if (lines.length < 3) return null;

  // Header line 1: column names, line 2: units
  const cols = lines[0].replace(/^#/, "").trim().split(/\s+/);
  const data = [];

  for (let i = 2; i < Math.min(lines.length, 26); i++) { // last 24 hours max
    const vals = lines[i].trim().split(/\s+/);
    if (vals.length < 10) continue;

    const colMap = {};
    cols.forEach((c, j) => { colMap[c] = vals[j]; });

    // Parse key fields
    const yr = parseInt(colMap.YY || colMap["#YY"]);
    const mo = parseInt(colMap.MM);
    const dd = parseInt(colMap.DD);
    const hh = parseInt(colMap.hh);
    const mm = parseInt(colMap.mm || "0");
    const time = new Date(Date.UTC(yr, mo - 1, dd, hh, mm));

    const parse = (key) => {
      const v = parseFloat(colMap[key]);
      return (v === 99 || v === 999 || v === 9999 || isNaN(v)) ? null : v;
    };

    data.push({
      time: time.getTime(),
      waveHeight: parse("WVHT"),   // m
      wavePeriod: parse("DPD"),    // dominant period, s
      waveDir: parse("MWD"),       // mean wave direction, deg
      windSpeed: parse("WSPD"),    // m/s
      windDir: parse("WDIR"),      // deg
      windGust: parse("GST"),      // m/s
      pressure: parse("PRES"),     // hPa
      airTemp: parse("ATMP"),      // °C
      waterTemp: parse("WTMP"),    // °C
    });
  }

  const buoy = NDBC_BUOYS[buoyId] || { lat: 0, lon: 0, name: buoyId };
  return { buoyId, ...buoy, observations: data, fetchedAt: Date.now() };
}

// ── Fetch a single buoy's real-time data ────────────────────────────────────
export async function fetchBuoy(buoyId) {
  const url = `${NDBC_BASE}/${buoyId}.txt`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const text = await resp.text();
    return parseNdbcTxt(text, buoyId);
  } catch { return null; }
}

// ── Fetch all buoys within a bounding box ───────────────────────────────────
export async function fetchBuoysInBounds(bounds) {
  const { south, north, west, east } = bounds;
  const inBounds = Object.entries(NDBC_BUOYS).filter(([_, b]) =>
    b.lat >= south && b.lat <= north && b.lon >= west && b.lon <= east
  );
  if (!inBounds.length) return [];

  const results = await Promise.allSettled(
    inBounds.map(([id]) => fetchBuoy(id))
  );
  return results
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter(Boolean);
}

// ── Compare forecast vs observed at a buoy location ─────────────────────────
// Returns { buoyId, forecastHs, observedHs, errorM, errorPct, ... }
export function compareWithForecast(buoyData, forecastPoint) {
  if (!buoyData?.observations?.length || !forecastPoint) return null;
  const latest = buoyData.observations[0]; // most recent observation
  if (!latest.waveHeight) return null;

  const obsHs = latest.waveHeight;
  const fcastHs = forecastPoint.waveHeight ?? forecastPoint.waveHeight;
  if (fcastHs == null) return null;

  const errorM = fcastHs - obsHs;
  const errorPct = obsHs > 0 ? Math.abs(errorM / obsHs) * 100 : 0;

  return {
    buoyId: buoyData.buoyId,
    buoyName: buoyData.name,
    lat: buoyData.lat, lon: buoyData.lon,
    observedHs: obsHs,
    observedTp: latest.wavePeriod,
    observedDir: latest.waveDir,
    forecastHs: fcastHs,
    errorM: Math.round(errorM * 100) / 100,
    errorPct: Math.round(errorPct),
    quality: errorPct < 15 ? "good" : errorPct < 30 ? "fair" : "poor",
    obsTime: latest.time,
  };
}
