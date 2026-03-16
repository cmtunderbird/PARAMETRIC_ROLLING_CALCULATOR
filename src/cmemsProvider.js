// ─── cmemsProvider.js ──────────────────────────────────────────────────────────
// In Electron: all CMEMS calls go through window.electronAPI.cmems.*
//   Main process waits for server, builds request, returns JSON. No fetch() here.
// In browser dev: direct fetch via Vite proxy to /api/cmems/*

export const CMEMS_WAVE_DATASET    = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i";
export const CMEMS_PHYSICS_DATASET = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m";

// Returns true when running inside Electron desktop app
const isElectron = () =>
  typeof window !== 'undefined' && window.electronAPI?.isElectron === true;

// ── Browser-only helpers (Vite dev path) ──────────────────────────────────────
function cmemsBase() { return '/api/cmems'; }

function authHeader(user, pass) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
}

async function browserFetch(path, user, pass) {
  const r = await fetch(`${cmemsBase()}${path}`, {
    headers: { Authorization: authHeader(user, pass) },
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// ─── Connection test ──────────────────────────────────────────────────────────
export async function testCmemsConnection(user, pass) {
  if (!user || !pass) return { ok: false, message: 'Enter username and password first.' };
  try {
    if (isElectron()) {
      return await window.electronAPI.cmems.test(user, pass);
    }
    return await browserFetch('/test', user, pass);
  } catch(e) {
    return { ok: false, message: `❌ ${e.message}` };
  }
}

// ─── Wave grid fetch ──────────────────────────────────────────────────────────
export async function cmemsWaveGrid(user, pass, bounds, forecastDays = 7) {
  const { south, north, west, east } = bounds;
  const s = (n) => parseFloat(n.toFixed(3));
  if (isElectron()) {
    return await window.electronAPI.cmems.wave(user, pass, s(south), s(north), s(west), s(east), forecastDays);
  }
  const q = new URLSearchParams({ south: s(south), north: s(north), west: s(west), east: s(east), forecastDays });
  return browserFetch(`/wave?${q}`, user, pass);
}

// ─── Physics grid fetch (currents + SST) ─────────────────────────────────────
export async function cmemsPhysicsGrid(user, pass, bounds) {
  const { south, north, west, east } = bounds;
  const s = (n) => parseFloat(n.toFixed(3));
  if (isElectron()) {
    return await window.electronAPI.cmems.physics(user, pass, s(south), s(north), s(west), s(east));
  }
  const q = new URLSearchParams({ south: s(south), north: s(north), west: s(west), east: s(east) });
  return browserFetch(`/physics?${q}`, user, pass);
}

// ─── Credentials ─────────────────────────────────────────────────────────────
// Electron: safeStorage → Windows Credential Manager (persists across restarts)
// Browser:  sessionStorage (cleared on tab close)

export async function saveCmemsCredentials(user, pass) {
  if (isElectron()) {
    try { await window.electronAPI.credsSave(user, pass); return; } catch { /* fallback */ }
  }
  try { sessionStorage.setItem('cmems_user', user); sessionStorage.setItem('cmems_pass', pass); }
  catch { /* ignore */ }
}

export async function loadCmemsCredentials() {
  if (isElectron()) {
    try { return await window.electronAPI.credsLoad(); } catch { /* fallback */ }
  }
  try {
    return {
      user: sessionStorage.getItem('cmems_user') || '',
      pass: sessionStorage.getItem('cmems_pass') || '',
    };
  } catch { return { user: '', pass: '' }; }
}

export async function clearCmemsCredentials() {
  if (isElectron()) {
    try { await window.electronAPI.credsClear(); return; } catch { /* fallback */ }
  }
  try { sessionStorage.removeItem('cmems_user'); sessionStorage.removeItem('cmems_pass'); }
  catch { /* ignore */ }
}
