// ─── weatherValidation.js ──────────────────────────────────────────────────────
// Sanitises raw weather data before it enters the physics engine.
//
// Problem: Open-Meteo and CMEMS both return fill / sentinel values for missing
// or land-masked grid points:
//   • Open-Meteo  → JSON null  (usually fine, but occasionally 9999 / NaN)
//   • CMEMS NetCDF→ 9.96921e+36 (standard CF fill value), NaN, ±Inf
//   • Some older GRIB sources → 999, -999, 9999, -9999
//
// Any of these fed raw into calcMotions() will produce nonsense results:
//   • waveHeight = 9999 m  → roll = 45° (capped), slam = 100%, FORBIDDEN
//   • wavePeriod = 0       → division by zero in encounter frequency
//   • NaN anywhere         → all downstream calcs become NaN silently
//
// This module provides a single sanitizeWxPoint() export that:
//   1. Replaces non-finite values and known fill values with null
//   2. Clips every physical variable to its valid meteorological/oceanographic range
//   3. Returns a clean point object safe to pass directly to calcMotions()
//
// Physical range references:
//   waveHeight  : 0–30 m  (WMO record significant wave height ~20 m; 30 m absolute cap)
//   wavePeriod  : 1–30 s  (< 1 s not physically meaningful; > 30 s extremely rare)
//   waveDir     : 0–360°  (wrap, not clip)
//   swellHeight : 0–20 m
//   swellPeriod : 3–30 s
//   windKts     : 0–150 kts (Cat 5 ~140 kts sustained; 150 allows for gusts)
//   windDir     : 0–360°
//   mslp        : 870–1084 hPa (all-time records)
//   currentSpeed: 0–5 m/s  (Gulf Stream ~2.5 m/s; 5 m/s is extreme)
//   sst         : -2–35 °C
//   pressure    : alias for mslp

// ── Known sentinel / fill values ─────────────────────────────────────────────
const FILL_VALUES = new Set([
  9.96921e36, 9.96920996838687e36,  // CF NetCDF default fill
  9999, -9999, 999, -999,           // common GRIB / legacy fill
  99999, -99999,
  1e20, -1e20,                      // some CMEMS variables
]);

const FILL_THRESHOLD = 1e10;  // anything > this magnitude is a fill value

/**
 * Returns null if the value is a fill value, NaN, Inf, or outside [min, max].
 * Returns the original value (not clamped) if in range — we want to know about
 * genuine extreme values rather than silently clamp them to the limit.
 */
function sanitize(v, min, max) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) return null;
  if (FILL_VALUES.has(n)) return null;
  if (Math.abs(n) > FILL_THRESHOLD) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Sanitises a direction value: must be 0–360, wrap values > 360 back into range.
 */
function sanitizeDir(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) return null;
  if (Math.abs(n) > FILL_THRESHOLD) return null;
  // Wrap into [0, 360)
  return ((n % 360) + 360) % 360;
}

/**
 * Sanitises an array of values — used for time-series arrays from CMEMS/Open-Meteo.
 * Returns a new array where each element is either a valid number or null.
 */
function sanitizeArray(arr, min, max, isDir = false) {
  if (!Array.isArray(arr)) return null;
  return arr.map(v => isDir ? sanitizeDir(v) : sanitize(v, min, max));
}

// ── Physical limits ───────────────────────────────────────────────────────────
const LIMITS = {
  waveHeight:   [0,   30],
  wavePeriod:   [1,   30],
  swellHeight:  [0,   20],
  swellPeriod:  [3,   30],
  windWaveH:    [0,   20],
  windWaveT:    [1,   25],
  windKts:      [0,  150],
  mslp:         [870, 1084],
  currentSpeed: [0,    5],
  currentU:     [-5,   5],
  currentV:     [-5,   5],
  sst:          [-2,  35],
};

/**
 * Sanitise a single weather data point (as returned by the grid fetchers).
 * Both scalar (dashboard point) and array (grid point) forms are handled.
 *
 * @param {object} pt  - Raw weather point from Open-Meteo or CMEMS
 * @returns {object}   - Clean point safe to pass to calcMotions()
 */
export function sanitizeWxPoint(pt) {
  if (!pt || pt.error) return pt;  // pass through error points unchanged

  const clean = { ...pt };

  // ── Array fields (grid time-series) ──────────────────────────────────────
  const arrFields = [
    ['waveHeight',  0,  30,  false],
    ['wavePeriod',  1,  30,  false],
    ['waveDir',     0, 360,  true ],
    ['swellHeight', 0,  20,  false],
    ['swellPeriod', 3,  30,  false],
    ['swellDir',    0, 360,  true ],
    ['windWaveH',   0,  20,  false],
    ['windWaveT',   1,  25,  false],
    ['windWaveDir', 0, 360,  true ],
    ['windKts',     0, 150,  false],
    ['windDir',     0, 360,  true ],
    ['mslp',      870, 1084, false],
    ['currentSpeed',0,   5,  false],
    ['currentU',   -5,   5,  false],
    ['currentV',   -5,   5,  false],
    ['sst',        -2,  35,  false],
  ];

  for (const [field, min, max, isDir] of arrFields) {
    if (field in clean) {
      const v = clean[field];
      if (Array.isArray(v)) {
        clean[field] = sanitizeArray(v, min, max, isDir);
      } else if (v !== null && v !== undefined) {
        // Scalar (dashboard single-point)
        clean[field] = isDir ? sanitizeDir(v) : sanitize(v, min, max);
      }
    }
  }

  return clean;
}

/**
 * Sanitise a scalar snapshot object (e.g. the hourly snapshot passed to calcMotions).
 * Same as sanitizeWxPoint but operates on plain scalar fields, not arrays.
 */
export function sanitizeWxSnapshot(snap) {
  if (!snap) return snap;
  return {
    ...snap,
    waveHeight:   sanitize(snap.waveHeight,   0,   30),
    wavePeriod:   sanitize(snap.wavePeriod,   1,   30),
    waveDir:      sanitizeDir(snap.waveDir),
    swellHeight:  sanitize(snap.swellHeight,  0,   20),
    swellPeriod:  sanitize(snap.swellPeriod,  3,   30),
    swellDir:     sanitizeDir(snap.swellDir),
    windWaveH:    sanitize(snap.windWaveH,    0,   20),
    windWaveT:    sanitize(snap.windWaveT,    1,   25),
    windWaveDir:  sanitizeDir(snap.windWaveDir),
    windKts:      sanitize(snap.windKts,      0,  150),
    windDir:      sanitizeDir(snap.windDir),
    mslp:         sanitize(snap.mslp,       870, 1084),
    currentSpeed: sanitize(snap.currentSpeed, 0,    5),
    currentU:     sanitize(snap.currentU,    -5,    5),
    currentV:     sanitize(snap.currentV,    -5,    5),
    sst:          sanitize(snap.sst,         -2,   35),
  };
}
