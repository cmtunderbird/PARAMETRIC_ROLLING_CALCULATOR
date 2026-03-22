// ─── Open-Meteo Weather Provider ─────────────────────────────────────────────
// Extracted from App.jsx — Phase 1, Item 4
// Common interface: { fetchForecast(lat, lon, days) → StandardResult[] }

export const OPEN_METEO_SOURCES = {
  "open-meteo-marine": {
    name: "Open-Meteo Marine",
    desc: "DWD ICON + ECMWF WAM wave models",
    free: true,
    buildUrl: (lat, lon, days = 7) =>
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction&forecast_days=${days}&timeformat=unixtime`,
    parse: (data) => {
      const h = data.hourly;
      return h.time.map((t, i) => ({
        time: t * 1000,
        waveHeight: h.wave_height?.[i] ?? null,
        waveDir: h.wave_direction?.[i] ?? null,
        wavePeriod: h.wave_period?.[i] ?? null,
        swellHeight: h.swell_wave_height?.[i] ?? null,
        swellPeriod: h.swell_wave_period?.[i] ?? null,
        swellDir: h.swell_wave_direction?.[i] ?? null,
        windWaveHeight: h.wind_wave_height?.[i] ?? null,
        windWavePeriod: h.wind_wave_period?.[i] ?? null,
        windWaveDir: h.wind_wave_direction?.[i] ?? null,
      }));
    },
  },
  "open-meteo-weather": {
    name: "Open-Meteo Weather",
    desc: "Wind speed & direction (atmospheric)",
    free: true,
    buildUrl: (lat, lon, days = 7) =>
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_days=${days}&timeformat=unixtime`,
    parse: (data) => {
      const h = data.hourly;
      return h.time.map((t, i) => ({
        time: t * 1000,
        windSpeed: h.wind_speed_10m?.[i] ?? null,
        windDir: h.wind_direction_10m?.[i] ?? null,
        windGusts: h.wind_gusts_10m?.[i] ?? null,
      }));
    },
  },
};

// ─── Fetch with retry (exponential backoff on 429) ──────────────────────────
export async function fetchOpenMeteo(sourceKey, lat, lon, days = 7) {
  const src = OPEN_METEO_SOURCES[sourceKey];
  if (!src) throw new Error(`Unknown Open-Meteo source: ${sourceKey}`);
  const url = src.buildUrl(lat, lon, days);
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url);
    if (resp.status === 429) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 20000);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!resp.ok) throw new Error(`${src.name}: HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(`${src.name}: ${data.reason}`);
    return src.parse(data);
  }
  throw new Error(`${src.name}: rate limited after retries`);
}

// ─── Convenience: fetch marine + weather in sequence ────────────────────────
export async function fetchOpenMeteoPoint(lat, lon, days = 7) {
  const marine = await fetchOpenMeteo("open-meteo-marine", lat, lon, days);
  await new Promise(r => setTimeout(r, 1200)); // gap to avoid 429
  const weather = await fetchOpenMeteo("open-meteo-weather", lat, lon, days);
  return { marine, weather };
}
