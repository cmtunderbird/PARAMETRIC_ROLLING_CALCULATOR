// ─── NOAA GFS Weather Provider (Stub) ────────────────────────────────────────
// Phase 1, Item 4 — interface only, implementation in Phase 3, Item 19
//
// Will fetch GFS 0.25° wind fields from NOAA NOMADS GRIB filter.
// No API key required. Provides 10m wind speed/direction, MSLP.
// GRIB2 decoding will run in cmems_worker.py via Express bridge.

export const NOAA_SOURCES = {
  "noaa-gfs": {
    name: "NOAA GFS",
    desc: "Global Forecast System 0.25° wind + MSLP (NOMADS)",
    free: true,
    status: "planned",
  },
  "noaa-wwiii": {
    name: "NOAA WaveWatch III",
    desc: "Global wave model 0.5° Hs/Tp/Dir (NOMADS)",
    free: true,
    status: "planned",
  },
};

export async function fetchNoaaGfs(/* lat, lon, days */) {
  throw new Error("NOAA GFS provider not yet implemented (Phase 3, Item 19)");
}

export async function fetchNoaaWaveWatch(/* lat, lon, days */) {
  throw new Error("NOAA WaveWatch III provider not yet implemented (Phase 3, Item 20)");
}
