// ─── Weather Providers — unified export ──────────────────────────────────────
// Phase 1, Item 4
export {
  OPEN_METEO_SOURCES,
  fetchOpenMeteo,
  fetchOpenMeteoPoint,
} from "./openMeteo.js";

export {
  NOAA_SOURCES,
  fetchNoaaGfs,
  fetchNoaaGfsPoint,
  isNoaaGfsAvailable,
  fetchNoaaWaveWatch,
} from "./noaaGfs.js";

// ─── Combined source registry (for UI display) ─────────────────────────────
// Re-exported so the Weather Sources tab can enumerate all known providers
import { OPEN_METEO_SOURCES } from "./openMeteo.js";
import { NOAA_SOURCES } from "./noaaGfs.js";

export const ALL_SOURCES = { ...OPEN_METEO_SOURCES, ...NOAA_SOURCES };
