// ─── cmemsProvider.js ──────────────────────────────────────────────────────────
// In Electron (file:// origin): all CMEMS calls go through window.electronAPI.cmems.*
//   Main process waits for server, builds request, returns JSON. No fetch() here.
// In browser dev (http:// origin): direct fetch via Vite proxy to /api/cmems/*

export const CMEMS_WAVE_DATASET    = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i";
export const CMEMS_PHYSICS_DATASET = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m";

// ── Runtime detection ─────────────────────────────────────────────────────────
// file:// protocol means Electron production — never browser dev.
// This is the only check that cannot be fooled by preload timing.
function onFileProtocol() {
  return typeof window !== 'undefined' && window.location?.protocol === 'file:';
}

// Whether the electronAPI.cmems bridge is available
function hasCmemsBridge() {
  return typeof window !== 'undefined' &&
         typeof window.electronAPI?.cmems?.test === 'function';
}

// ── Browser-only helpers (Vite dev / http:// path) ────────────────────────────
function authHeader(user, pass) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
}

async function browserFetch(path, user, pass) {
  const r = await fetch(`/api/cmems${path}`, {
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
    if (onFileProtocol()) {
      // Electron: must use IPC bridge — fetch() is blocked on file:// origin
      if (!hasCmemsBridge()) {
        return { ok: false, message: '❌ Electron IPC bridge not available. Try relaunching the app.' };
      }
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
  const r = n => parseFloat(n.toFixed(3));
  if (onFileProtocol() && hasCmemsBridge()) {
    return window.electronAPI.cmems.wave(user, pass, r(south), r(north), r(west), r(east), forecastDays);
  }
  const q = new URLSearchParams({ south: r(south), north: r(north), west: r(west), east: r(east), forecastDays });
  return browserFetch(`/wave?${q}`, user, pass);
}

// ─── Physics grid fetch (currents + SST) ─────────────────────────────────────
export async function cmemsPhysicsGrid(user, pass, bounds) {
  const { south, north, west, east } = bounds;
  const r = n => parseFloat(n.toFixed(3));
  if (onFileProtocol() && hasCmemsBridge()) {
    return window.electronAPI.cmems.physics(user, pass, r(south), r(north), r(west), r(east));
  }
  const q = new URLSearchParams({ south: r(south), north: r(north), west: r(west), east: r(east) });
  return browserFetch(`/physics?${q}`, user, pass);
}

// ─── Credentials ─────────────────────────────────────────────────────────────
const hasCredsBridge = () =>
  typeof window !== 'undefined' &&
  typeof window.electronAPI?.credsSave === 'function';

export async function saveCmemsCredentials(user, pass) {
  if (hasCredsBridge()) {
    try { await window.electronAPI.credsSave(user, pass); return; } catch { /* fallback */ }
  }
  try { sessionStorage.setItem('cmems_user', user); sessionStorage.setItem('cmems_pass', pass); }
  catch { /* ignore */ }
}

export async function loadCmemsCredentials() {
  if (hasCredsBridge()) {
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
  if (hasCredsBridge()) {
    try { await window.electronAPI.credsClear(); return; } catch { /* fallback */ }
  }
  try { sessionStorage.removeItem('cmems_user'); sessionStorage.removeItem('cmems_pass'); }
  catch { /* ignore */ }
}
