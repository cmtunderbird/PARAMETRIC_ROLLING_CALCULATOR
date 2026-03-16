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
// Strategy (Electron): the main process tracks a cmemsReady flag via stdout.
//   - If already ready (server was up before button click): IPC returns true instantly.
//   - If not ready yet: wait for the 'cmems:ready' push event (up to 30 s),
//     OR fall back to polling the flag every 500 ms.
// Strategy (browser dev): direct fetch to /api/cmems/health via Vite proxy.
async function serverAlive() {
  if (typeof window === 'undefined') return false;

  // ── Electron path ─────────────────────────────────────────────────────────
  if (window.electronAPI?.checkServerAlive) {
    // 1. Fast path: flag already set (server was running before click)
    try {
      if (await window.electronAPI.checkServerAlive()) return true;
    } catch { /* ignore */ }

    // 2. Wait for push event OR poll flag — whichever fires first (30 s max)
    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => { if (!done) { done = true; clearInterval(poll); resolve(val); } };

      // Push event: main process fires the instant stdout says "running"
      if (window.electronAPI.onCmemsReady) {
        window.electronAPI.onCmemsReady(() => finish(true));
      }

      // Polling fallback: check flag every 500 ms
      const poll = setInterval(async () => {
        try {
          if (await window.electronAPI.checkServerAlive()) finish(true);
        } catch { /* ignore */ }
      }, 500);

      // Hard timeout after 30 s
      setTimeout(() => finish(false), 30000);
    });
  }

  // ── Browser dev path ──────────────────────────────────────────────────────
  try {
    const r = await fetch(`${cmemsBase()}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}

// ─── Connection test ──────────────────────────────────────────────────────────
export async function testCmemsConnection(user, pass) {
  if (!user || !pass) return { ok: false, message: "Enter username and password first." };
  // serverAlive() retries for up to 15 s — handles post-reboot startup lag
  const alive = await serverAlive();
  if (!alive) return {
    ok: false,
    message: "❌ CMEMS server failed to start. Ensure Node.js is installed and launch via the desktop shortcut.",
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
