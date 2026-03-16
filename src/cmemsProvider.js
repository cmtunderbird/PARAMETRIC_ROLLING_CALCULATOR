// ─── cmemsProvider.js ──────────────────────────────────────────────────────────
// Copernicus Marine Service (CMEMS) data provider — v2 Toolbox API.
//
// Architecture (April 2024 migration):
//   OLD (dead): nrt.cmems-du.eu THREDDS/OPeNDAP → squatted domain
//   NEW:        browser → cmems-server.js (port 5174) → Python copernicusmarine v2
//
// The browser calls /api/cmems/* which Vite proxies to localhost:5174.
// cmems-server.js spawns Python scripts using the installed copernicusmarine
// package (pip install copernicusmarine), which handles auth + lazy-loading
// from the new Copernicus Marine Data Store (ARCO cloud-native format).
//
// Datasets (same as windmar):
//   Wave:    cmems_mod_glo_wav_anfc_0.083deg_PT3H-i
//   Physics: cmems_mod_glo_phy_anfc_0.083deg_PT1H-m

const CMEMS_BASE = "/api/cmems";

export const CMEMS_WAVE_DATASET    = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i";
export const CMEMS_PHYSICS_DATASET = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m";

// ─── Auth header (Basic) — credentials never appear in URL or logs ────────────
function authHeader(user, pass) {
  return "Basic " + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
}

// ─── Server health check ──────────────────────────────────────────────────────
async function serverAlive() {
  try {
    const r = await fetch(`${CMEMS_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

// ─── Connection test ──────────────────────────────────────────────────────────
export async function testCmemsConnection(user, pass) {
  if (!user || !pass) return { ok: false, message: "Enter username and password first." };

  // Check local server is running before attempting CMEMS auth
  const alive = await serverAlive();
  if (!alive) return {
    ok: false,
    message: "❌ CMEMS server not running — launch the app via the desktop shortcut (launch.bat) which starts cmems-server.js automatically. Or run: node cmems-server.js",
  };

  try {
    const resp = await fetch(`${CMEMS_BASE}/test`, {
      headers: { Authorization: authHeader(user, pass) },
      signal: AbortSignal.timeout(90000),
    });
    const result = await resp.json();
    return result;
  } catch(e) {
    return { ok: false, message: `❌ ${e.message}` };
  }
}

// ─── Wave grid fetch ──────────────────────────────────────────────────────────
// Returns array of point objects with same keys as fetchMarineGrid()
export async function cmemsWaveGrid(user, pass, bounds, forecastDays = 7) {
  const { south, north, west, east } = bounds;
  const params = new URLSearchParams({
    south: south.toFixed(3), north: north.toFixed(3),
    west:  west.toFixed(3),  east:  east.toFixed(3),
    forecastDays,
  });
  const resp = await fetch(`${CMEMS_BASE}/wave?${params}`, {
    headers: { Authorization: authHeader(user, pass) },
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`CMEMS wave: ${body.error || resp.status}`);
  }
  return resp.json();
}

// ─── Physics grid fetch (currents + SST) ─────────────────────────────────────
export async function cmemsPhysicsGrid(user, pass, bounds, forecastDays = 2) {
  const { south, north, west, east } = bounds;
  const params = new URLSearchParams({
    south: south.toFixed(3), north: north.toFixed(3),
    west:  west.toFixed(3),  east:  east.toFixed(3),
  });
  const resp = await fetch(`${CMEMS_BASE}/physics?${params}`, {
    headers: { Authorization: authHeader(user, pass) },
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`CMEMS physics: ${body.error || resp.status}`);
  }
  return resp.json();
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

// ─── Removed (dead code from pre-April-2024 OPeNDAP implementation) ──────────
// fetchOPeNDAP()  — old THREDDS endpoint decommissioned April 2024
// mergeVarGrids() — handled server-side in cmems-server.js / cmems_worker.py
