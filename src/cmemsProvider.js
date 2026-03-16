// ─── cmemsProvider.js ──────────────────────────────────────────────────────────
// Copernicus Marine Service (CMEMS) data provider — v2 Toolbox API.
//
// Architecture (April 2024 migration):
//   OLD (dead): nrt.cmems-du.eu THREDDS/OPeNDAP → squatted domain
//   NEW:        browser → cmems-server.js (port 5174) → Python copernicusmarine v2
//
// Datasets (same as windmar):
//   Wave:    cmems_mod_glo_wav_anfc_0.083deg_PT3H-i
//   Physics: cmems_mod_glo_phy_anfc_0.083deg_PT1H-m

// ── API base: resolved lazily so Electron's preload has time to inject ────────
// In Electron:   http://localhost:5174/api/cmems  (direct, no Vite proxy)
// In browser:    /api/cmems                       (Vite dev proxy)
function cmemsBase() {
  return (typeof window !== 'undefined' && window.electronAPI?.isElectron)
    ? 'http://localhost:5174/api/cmems'
    : '/api/cmems';
}

export const CMEMS_WAVE_DATASET    = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i";
export const CMEMS_PHYSICS_DATASET = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m";

// ─── Auth header ──────────────────────────────────────────────────────────────
function authHeader(user, pass) {
  return "Basic " + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
}

// ─── IPC-aware fetch ──────────────────────────────────────────────────────────
// Chromium blocks http:// fetch() from a file:// origin (Electron production).
// All CMEMS HTTP calls go through IPC so the main process makes the request.
// In browser dev mode: falls back to native fetch (Vite proxy handles it).
async function cmemsFetch(url, headers = {}) {
  if (typeof window !== 'undefined' && window.electronAPI?.cmemsRequest) {
    const result = await window.electronAPI.cmemsRequest({ url, headers });
    if (!result.ok) {
      throw new Error(`CMEMS ${result.status}: ${result.json?.error || 'request failed'}`);
    }
    return result.json;
  }
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`CMEMS ${r.status}: ${body.error || r.statusText}`);
  }
  return r.json();
}

// ─── Server health check ──────────────────────────────────────────────────────
// In Electron: main process does the http.get() via IPC (no file:// restriction)
// In browser:  direct fetch via Vite proxy
async function serverAlive() {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.checkServerAlive) {
      return await window.electronAPI.checkServerAlive();
    }
    const r = await fetch(`${cmemsBase()}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}

// ─── Connection test ──────────────────────────────────────────────────────────
export async function testCmemsConnection(user, pass) {
  if (!user || !pass) return { ok: false, message: "Enter username and password first." };
  const alive = await serverAlive();
  if (!alive) return {
    ok: false,
    message: "❌ CMEMS server not running — launch via the desktop shortcut which starts it automatically.",
  };
  try {
    return await cmemsFetch(`${cmemsBase()}/test`, { Authorization: authHeader(user, pass) });
  } catch(e) {
    return { ok: false, message: `❌ ${e.message}` };
  }
}

// ─── Wave grid fetch ──────────────────────────────────────────────────────────
export async function cmemsWaveGrid(user, pass, bounds, forecastDays = 7) {
  const { south, north, west, east } = bounds;
  const params = new URLSearchParams({
    south: south.toFixed(3), north: north.toFixed(3),
    west:  west.toFixed(3),  east:  east.toFixed(3),
    forecastDays,
  });
  return cmemsFetch(`${cmemsBase()}/wave?${params}`, { Authorization: authHeader(user, pass) });
}

// ─── Physics grid fetch (currents + SST) ─────────────────────────────────────
export async function cmemsPhysicsGrid(user, pass, bounds) {
  const { south, north, west, east } = bounds;
  const params = new URLSearchParams({
    south: south.toFixed(3), north: north.toFixed(3),
    west:  west.toFixed(3),  east:  east.toFixed(3),
  });
  return cmemsFetch(`${cmemsBase()}/physics?${params}`, { Authorization: authHeader(user, pass) });
}

// ─── Credentials helpers ─────────────────────────────────────────────────────
// In Electron: persisted securely in OS keychain via safeStorage
// In browser:  sessionStorage only (cleared on tab close)
const isElectron = () => typeof window !== 'undefined' && window.electronAPI?.isElectron;

export async function saveCmemsCredentials(user, pass) {
  if (isElectron()) {
    try { await window.electronAPI.credsSave(user, pass); return; } catch { /* fallback */ }
  }
  try { sessionStorage.setItem("cmems_user", user); sessionStorage.setItem("cmems_pass", pass); }
  catch { /* ignore */ }
}

export async function loadCmemsCredentials() {
  if (isElectron()) {
    try { return await window.electronAPI.credsLoad(); } catch { /* fallback */ }
  }
  try {
    return {
      user: sessionStorage.getItem("cmems_user") || "",
      pass: sessionStorage.getItem("cmems_pass") || "",
    };
  } catch { return { user: "", pass: "" }; }
}

export async function clearCmemsCredentials() {
  if (isElectron()) {
    try { await window.electronAPI.credsClear(); return; } catch { /* fallback */ }
  }
  try { sessionStorage.removeItem("cmems_user"); sessionStorage.removeItem("cmems_pass"); }
  catch { /* ignore */ }
}
