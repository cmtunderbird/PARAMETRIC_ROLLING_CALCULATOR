// ─── weatherCache.js ───────────────────────────────────────────────────────────
// Persistent localStorage weather cache.
// Survives page reloads and code changes.
// Auto-invalidates when:
//   • Data is stale  (marine > 6 h, atmospheric > 3 h — matches Open-Meteo GFS cadence)
//   • Area changes   (new bounding box doesn't overlap cached area within tolerance)
//   • Grid resolution changes

const STALE_MS = {
  marine:  6 * 3600 * 1000,   // GFS/CMEMS update every 6 h
  atmo:    3 * 3600 * 1000,   // GFS atmospheric every 3 h
  voyage:  6 * 3600 * 1000,
};
const CACHE_VER = "v1";  // bump to nuke all caches after schema changes
const MAX_ENTRIES = 8;   // keep at most 8 cached areas in localStorage

// ── Key helpers ───────────────────────────────────────────────────────────────
function boundsKey(bounds, gridRes) {
  const r = (v) => Math.round(v * 10) / 10; // round to 0.1°
  return `${r(bounds.south)},${r(bounds.north)},${r(bounds.west)},${r(bounds.east)},${gridRes}`;
}

function lsKey(type, bKey) {
  return `wxcache_${CACHE_VER}_${type}_${bKey}`;
}

// ── Bounds overlap check ──────────────────────────────────────────────────────
// Returns true if cached bounds fully contain (with tolerance) the requested bounds
function boundsContain(cached, requested, tol = 0.5) {
  return cached.south <= requested.south + tol &&
         cached.north >= requested.north - tol &&
         cached.west  <= requested.west  + tol &&
         cached.east  >= requested.east  - tol;
}

// ── Evict oldest entries if over limit ───────────────────────────────────────
function evictOldEntries() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`wxcache_${CACHE_VER}_`)) keys.push(k);
    }
    if (keys.length <= MAX_ENTRIES) return;
    // Sort by fetchedAt, remove oldest
    const entries = keys.map(k => {
      try { return { k, t: JSON.parse(localStorage.getItem(k))?.fetchedAt || 0 }; }
      catch { return { k, t: 0 }; }
    }).sort((a, b) => a.t - b.t);
    entries.slice(0, entries.length - MAX_ENTRIES).forEach(e => localStorage.removeItem(e.k));
  } catch { /* quota errors — silently ignore */ }
}

// ── Read from cache ───────────────────────────────────────────────────────────
export function cacheGet(type, bounds, gridRes) {
  try {
    const bKey = boundsKey(bounds, gridRes);
    const raw  = localStorage.getItem(lsKey(type, bKey));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // Version check
    if (entry.ver !== CACHE_VER) return null;
    // Staleness check
    if (Date.now() - entry.fetchedAt > STALE_MS[type]) return null;
    // Bounds check — cached area must contain requested area
    if (!boundsContain(entry.bounds, bounds)) return null;
    return entry;      // { results, fetchedAt, bounds, gridRes, ver }
  } catch { return null; }
}

// ── Write to cache ────────────────────────────────────────────────────────────
export function cacheSet(type, bounds, gridRes, results) {
  try {
    evictOldEntries();
    const bKey = boundsKey(bounds, gridRes);
    const entry = {
      ver: CACHE_VER,
      type,
      fetchedAt: Date.now(),
      bounds,
      gridRes,
      results,
    };
    localStorage.setItem(lsKey(type, bKey), JSON.stringify(entry));
    return true;
  } catch (e) {
    // Quota exceeded — clear all caches and retry once
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith("wxcache_")) localStorage.removeItem(k);
      }
      localStorage.setItem(lsKey(type, boundsKey(bounds, gridRes)), JSON.stringify({
        ver: CACHE_VER, type, fetchedAt: Date.now(), bounds, gridRes, results,
      }));
    } catch { /* give up silently */ }
    return false;
  }
}

// ── Invalidate specific area ──────────────────────────────────────────────────
export function cacheInvalidate(type, bounds, gridRes) {
  try {
    const bKey = boundsKey(bounds, gridRes);
    localStorage.removeItem(lsKey(type, bKey));
  } catch { /* ignore */ }
}

// ── Invalidate all weather caches ─────────────────────────────────────────────
export function cacheClearAll() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("wxcache_")) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

// ── Cache status summary ──────────────────────────────────────────────────────
export function cacheStatus() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(`wxcache_${CACHE_VER}_`)) continue;
      try {
        const e = JSON.parse(localStorage.getItem(k));
        const ageMin = Math.round((Date.now() - e.fetchedAt) / 60000);
        const staleIn = Math.round((STALE_MS[e.type] - (Date.now() - e.fetchedAt)) / 60000);
        entries.push({
          type: e.type, ageMin,
          staleInMin: Math.max(0, staleIn),
          pts: e.results?.length || 0,
          bounds: e.bounds,
        });
      } catch { /* corrupt entry */ }
    }
  } catch { /* ignore */ }
  return entries;
}
