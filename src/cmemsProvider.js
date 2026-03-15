// ─── cmemsProvider.js ──────────────────────────────────────────────────────────
// Copernicus Marine Service (CMEMS) data provider for browser JS.
// Mirrors windmar's CopernicusDataProvider using the OPeNDAP ASCII service.
//
// Datasets (matching windmar exactly):
//   Wave:    cmems_mod_glo_wav_anfc_0.083deg_PT3H-i  (0.083°, 3-hourly)
//   Physics: cmems_mod_glo_phy_anfc_0.083deg_PT1H-m  (0.083°, 1-hourly)
//
// Auth: HTTP Basic (username:password) sent in Authorization header.
// The Vite dev server proxies /cmems-proxy/* → https://nrt.cmems-du.eu/thredds/dodsC/*
// so CORS is never an issue — all requests are same-origin from the browser's perspective.
//
// Get a free account at https://data.marine.copernicus.eu/register

// ── Use local Vite proxy (same-origin → no CORS) ─────────────────────────────
// In dev:  /cmems-proxy → Vite proxy → nrt.cmems-du.eu/thredds/dodsC
// In prod: /cmems-proxy → must be served by a reverse proxy (nginx/caddy)
//          (for local use via npm run dev, the Vite proxy always handles it)
const THREDDS = "/cmems-proxy";
const WAVE_DS  = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i";
const PHY_DS   = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m";

// Grid spec — 0.083° resolution (matches windmar CMEMS_WAVE_DATASET)
const WAVE_LAT_ORIGIN = -80.0;
const WAVE_LON_ORIGIN = -180.0;
const WAVE_RES        =  0.083;

function latIdx(lat) { return Math.round((lat - WAVE_LAT_ORIGIN) / WAVE_RES); }
function lonIdx(lon) {
  const l = ((lon + 180) % 360) - 180; // normalise -180..180
  return Math.round((l - WAVE_LON_ORIGIN) / WAVE_RES);
}

// ─── Build auth header ─────────────────────────────────────────────────────────
export function cmemsAuthHeader(user, pass) {
  return "Basic " + btoa(`${user}:${pass}`);
}

// ─── OPeNDAP ASCII fetch + parser ─────────────────────────────────────────────
// Returns { grid: Float32Array[][], lats: number[], lons: number[], times: number }
// grid[t][flatIdx] = value  (row-major: flat index = row*ncols + col)
async function fetchOPeNDAP(auth, dataset, variable, t0, t1, lat0, lat1, lon0, lon1, depthIdx = null) {
  const dep = depthIdx !== null ? `[${depthIdx}]` : "";
  const url  = `${THREDDS}/${dataset}.ascii?${variable}[${t0}:${t1}]${dep}[${lat0}:${lat1}][${lon0}:${lon1}]`;
  // Requests go through the Vite proxy at /cmems-proxy — no CORS issue
  const resp = await fetch(url, { headers: { Authorization: auth } });
  if (resp.status === 401) throw new Error("CMEMS authentication failed — check username and password.");
  if (resp.status === 404) throw new Error(`CMEMS dataset not found: ${dataset}`);
  if (!resp.ok) throw new Error(`CMEMS HTTP ${resp.status} for ${variable}`);
  const text = await resp.text();
  return parseOPeNDAPAscii(text, variable);
}

// Parse OPeNDAP ASCII response into a flat object per grid cell
// Response format after "---" separator:
//   varName, [T][M][N]\n[0][0], v0, v1, ...\n[0][1], v0, v1, ...
function parseOPeNDAPAscii(text, variable) {
  const sep  = text.indexOf("-----");
  if (sep < 0) throw new Error("CMEMS: unexpected OPeNDAP response format");
  const body = text.slice(sep + 5).trim();
  const lines = body.split("\n").filter(l => l.trim());
  // First line: "varName, [T][M][N]"
  const dimMatch = lines[0].match(/\[(\d+)\]\[(\d+)\]\[(\d+)\]/);
  if (!dimMatch) throw new Error("CMEMS: cannot parse OPeNDAP dimensions");
  const [, nT, nLat, nLon] = dimMatch.map(Number);
  // Data lines: "[t][lat], v0, v1, v2..."
  const grids = Array.from({ length: nT }, () => new Float32Array(nLat * nLon).fill(NaN));
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^\[(\d+)\]\[(\d+)\],(.+)/);
    if (!m) continue;
    const t = parseInt(m[1]), latI = parseInt(m[2]);
    const vals = m[3].split(",").map(v => parseFloat(v.trim()));
    for (let j = 0; j < vals.length; j++) {
      if (latI * nLon + j < grids[t].length)
        grids[t][latI * nLon + j] = vals[j];
    }
  }
  return { grids, nT, nLat, nLon };
}

// ─── Convert flat parsed grids → point results (same shape as Open-Meteo) ────
function gridToPoints(parsed, bounds, varMap, forecastDays = 7) {
  const { grids, nT, nLat, nLon } = parsed;
  const latRes = (bounds.north - bounds.south) / Math.max(nLat - 1, 1);
  const lonRes = (bounds.east  - bounds.west)  / Math.max(nLon - 1, 1);
  // Build time axis: assume 3-hourly starting from now (wave dataset)
  const nowMs  = Date.now();
  const times  = Array.from({ length: nT }, (_, i) => Math.round((nowMs + i * 3 * 3600000) / 1000));
  const results = [];
  for (let ri = 0; ri < nLat; ri++) {
    for (let ci = 0; ci < nLon; ci++) {
      const lat = bounds.south + ri * latRes;
      const lon = bounds.west  + ci * lonRes;
      const pt  = { lat, lon, times, source: "cmems" };
      for (const [outKey, { grid, nLonG }] of Object.entries(varMap)) {
        pt[outKey] = Array.from({ length: nT }, (_, t) => {
          const v = grid.grids[t][ri * (nLonG || nLon) + ci];
          return isNaN(v) || v > 9e9 ? null : v;
        });
      }
      results.push(pt);
    }
  }
  return results;
}

// ─── Merge multiple variable grids into a single point array ─────────────────
function mergeVarGrids(parsedMap, bounds) {
  const keys = Object.keys(parsedMap);
  if (!keys.length) return [];
  const ref = parsedMap[keys[0]];
  const { nLat, nLon, nT } = ref;
  const nowMs = Date.now();
  const times = Array.from({ length: nT }, (_, i) => Math.round((nowMs + i * 3 * 3600000) / 1000));
  const latRes = nLat > 1 ? (bounds.north - bounds.south) / (nLat - 1) : 0;
  const lonRes = nLon > 1 ? (bounds.east  - bounds.west)  / (nLon - 1) : 0;
  const results = [];
  for (let ri = 0; ri < nLat; ri++) {
    for (let ci = 0; ci < nLon; ci++) {
      const lat = bounds.south + ri * latRes;
      const lon = bounds.west  + ci * lonRes;
      const pt  = { lat, lon, times, source: "cmems" };
      for (const [key, parsed] of Object.entries(parsedMap)) {
        pt[key] = Array.from({ length: nT }, (_, t) => {
          const v = parsed.grids[t][ri * nLon + ci];
          return (!v || isNaN(v) || v > 9e9 || v < -9e9) ? null : v;
        });
      }
      results.push(pt);
    }
  }
  return results;
}

// ─── CMEMS Wave Grid (matches windmar VHM0/VMDR/VHM0_WW/VHM0_SW1 etc.) ───────
// Returns array of point objects with same keys as fetchMarineGrid()
export async function cmemsWaveGrid(user, pass, bounds, forecastDays = 7) {
  const auth = cmemsAuthHeader(user, pass);
  const t0 = 0, t1 = Math.min(forecastDays * 8 - 1, 55); // 3-hourly → 7d = 56 steps
  const la0 = latIdx(bounds.south), la1 = latIdx(bounds.north);
  const lo0 = lonIdx(bounds.west),  lo1 = lonIdx(bounds.east);
  // Fetch windmar's exact variable set (VHM0, VMDR, VTM10, VHM0_WW, VHM0_SW1, etc.)
  const vars = {
    waveHeight:  "VHM0",
    waveDir:     "VMDR",
    wavePeriod:  "VTM10",
    windWaveH:   "VHM0_WW",
    windWaveT:   "VTM01_WW",
    windWaveDir: "VMDR_WW",
    swellHeight: "VHM0_SW1",
    swellPeriod: "VTM01_SW1",
    swellDir:    "VMDR_SW1",
  };
  const fetches = await Promise.allSettled(
    Object.entries(vars).map(([key, cmVar]) =>
      fetchOPeNDAP(auth, WAVE_DS, cmVar, t0, t1, la0, la1, lo0, lo1)
        .then(parsed => [key, parsed])
    )
  );
  const parsedMap = {};
  for (const r of fetches) {
    if (r.status === "fulfilled") parsedMap[r.value[0]] = r.value[1];
  }
  if (!Object.keys(parsedMap).length) throw new Error("CMEMS: no wave variables returned");
  const gb = {
    south: bounds.south, north: bounds.north,
    west:  bounds.west,  east:  bounds.east,
  };
  return mergeVarGrids(parsedMap, gb);
}

// ─── CMEMS Currents + SST (matches windmar uo/vo/thetao) ─────────────────────
// Returns results with currentU, currentV, currentSpeed, currentDir, sst
export async function cmemsPhysicsGrid(user, pass, bounds, forecastDays = 2) {
  const auth = cmemsAuthHeader(user, pass);
  const t0 = 0, t1 = Math.min(forecastDays * 24 - 1, 47); // 1-hourly → 2d = 48 steps
  const la0 = latIdx(bounds.south), la1 = latIdx(bounds.north);
  const lo0 = lonIdx(bounds.west),  lo1 = lonIdx(bounds.east);
  const depth = 0; // surface layer
  const vars = { currentU: "uo", currentV: "vo", sst: "thetao" };
  const fetches = await Promise.allSettled(
    Object.entries(vars).map(([key, cmVar]) =>
      fetchOPeNDAP(auth, PHY_DS, cmVar, t0, t1, la0, la1, lo0, lo1, depth)
        .then(parsed => [key, parsed])
    )
  );
  const parsedMap = {};
  for (const r of fetches) {
    if (r.status === "fulfilled") parsedMap[r.value[0]] = r.value[1];
  }
  if (!Object.keys(parsedMap).length) throw new Error("CMEMS: no physics variables returned");
  const gb = { south: bounds.south, north: bounds.north, west: bounds.west, east: bounds.east };
  const results = mergeVarGrids(parsedMap, gb);
  // Derive speed/direction from u/v (mirrors windmar's uo/vo computation)
  for (const pt of results) {
    if (pt.currentU && pt.currentV) {
      pt.currentSpeed = pt.currentU.map((u, i) => {
        const v = pt.currentV[i]; return (u != null && v != null) ? Math.sqrt(u*u + v*v) : null;
      });
      pt.currentDir = pt.currentU.map((u, i) => {
        const v = pt.currentV[i];
        return (u != null && v != null) ? ((Math.atan2(u, v) * 180 / Math.PI) + 360) % 360 : null;
      });
    }
  }
  return results;
}

// ─── Connection test ──────────────────────────────────────────────────────────
// Fetches a 1-point wave height sample to validate credentials + CORS
export async function testCmemsConnection(user, pass) {
  if (!user || !pass) return { ok: false, message: "Enter username and password first." };
  const auth = cmemsAuthHeader(user, pass);
  // 1-point, 1-timestep sample near Azores (open ocean, always has data)
  try {
    const parsed = await fetchOPeNDAP(auth, WAVE_DS, "VHM0", 0, 0,
      latIdx(38.0), latIdx(38.0), lonIdx(-28.0), lonIdx(-28.0));
    const v = parsed.grids[0]?.[0];
    if (v == null || isNaN(v)) return { ok: false, message: "CMEMS returned no data — check account activation or dataset availability." };
    return { ok: true, message: `✓ Connected via Vite proxy — test Hs = ${v.toFixed(2)} m at 38°N 28°W` };
  } catch (e) {
    if (e.message.includes("401")) return { ok: false, message: "❌ Authentication failed — check username and password." };
    if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
      return { ok: false, message: "❌ Network error — is the dev server (npm run dev) running? The Vite proxy is only active when launched via the desktop shortcut or npm run dev." };
    }
    return { ok: false, message: `❌ ${e.message}` };
  }
}

// ─── Credentials helpers (sessionStorage — never persisted to disk) ───────────
export function saveCmemsCredentials(user, pass) {
  try { sessionStorage.setItem("cmems_user", user); sessionStorage.setItem("cmems_pass", pass); }
  catch { /* ignore */ }
}
export function loadCmemsCredentials() {
  try { return { user: sessionStorage.getItem("cmems_user")||"", pass: sessionStorage.getItem("cmems_pass")||"" }; }
  catch { return { user: "", pass: "" }; }
}
export function clearCmemsCredentials() {
  try { sessionStorage.removeItem("cmems_user"); sessionStorage.removeItem("cmems_pass"); } catch { /* ignore */ }
}

// Re-export dataset names for display
export const CMEMS_WAVE_DATASET   = WAVE_DS;
export const CMEMS_PHYSICS_DATASET = PHY_DS;
