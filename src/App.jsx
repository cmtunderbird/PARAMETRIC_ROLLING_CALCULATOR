import { useState, useEffect, useCallback, useRef } from "react";
import RouteChart from "./RouteChart.jsx";
import { cacheGet, cacheSet } from "./weatherCache.js";
import { sanitizeWxSnapshot } from "./weatherValidation.js";
import {
  G, KTS_TO_MS, DEG_TO_RAD,
  calcNaturalRollPeriod, calcWaveLength,
  calcEncounterPeriod, calcEncounterFrequency,
  calcParametricRiskRatio, calcSynchronousRiskRatio,
  calcParametricRollRisk, calcKwonSpeedLossPct,
  calcMotions, getSafetyCostFactor, getMotionStatus,
  getRiskLevel, SafetyLimits,
} from "./physics.js";

// ── Extracted UI components ──
import Dashboard, { LOCATIONS } from "./ui/Dashboard.jsx";
import VesselConfig from "./ui/VesselConfig.jsx";
import {
  PolarRiskDiagram, inputStyle, sectionHeader, Panel,
  decimalToNautical, nauticalToDecimal,
  formatNauticalLat, formatNauticalLon,
} from "./ui/components/index.js";

// ─── Weather API Functions (stays here — will move to weather/providers in Item 4) ──
const WEATHER_SOURCES = {
  "open-meteo-marine": {
    name: "Open-Meteo Marine",
    desc: "DWD ICON + ECMWF WAM wave models",
    free: true,
    buildUrl: (lat, lon) =>
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction&forecast_days=7&timeformat=unixtime`,
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
    buildUrl: (lat, lon) =>
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_days=7&timeformat=unixtime`,
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

async function fetchWeatherData(sourceKey, lat, lon) {
  const src = WEATHER_SOURCES[sourceKey];
  const url = src.buildUrl(lat, lon);
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

// ─── Vessel Presets ──────────────────────────────────────────────────────────
const PRESETS = {
  container_large: { name: "Large Container (14,000 TEU)", Lwl: 350, B: 48.2, d: 14.5, GM: 1.8, Cb: 0.65, rollDamping: 0.05 },
  container_med:   { name: "Medium Container (4,000 TEU)", Lwl: 260, B: 32.2, d: 12.0, GM: 1.5, Cb: 0.62, rollDamping: 0.05 },
  container_small: { name: "Small Container (1,000 TEU)",  Lwl: 150, B: 25.0, d: 8.5,  GM: 1.2, Cb: 0.60, rollDamping: 0.06 },
  pcc:             { name: "Pure Car Carrier",              Lwl: 199, B: 32.3, d: 9.2,  GM: 2.0, Cb: 0.58, rollDamping: 0.05 },
  tanker:          { name: "VLCC Tanker (laden, w/ BK)",    Lwl: 320, B: 58,   d: 20.5, GM: 5.5, Cb: 0.82, rollDamping: 0.10 },
  bulk:            { name: "Capesize Bulker (w/ BK)",       Lwl: 280, B: 45,   d: 17.0, GM: 3.2, Cb: 0.85, rollDamping: 0.08 },
  roro:            { name: "Ro-Ro Ferry",                   Lwl: 186, B: 28.6, d: 6.8,  GM: 1.9, Cb: 0.55, rollDamping: 0.07 },
  custom:          { name: "Custom Vessel",                  Lwl: 200, B: 32,   d: 10,   GM: 1.5, Cb: 0.65, rollDamping: 0.05 },
};

// ─── Main App — State + Router ──────────────────────────────────────────────
export default function ParametricRollingCalculator() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [preset, setPreset] = useState("container_large");
  const [ship, setShip] = useState({ ...PRESETS.container_large });
  const [speed, setSpeed] = useState(18);
  const [heading, setHeading] = useState(0);
  const [locationKey, setLocationKey] = useState("North Atlantic");
  const [latDeg, setLatDeg] = useState(50);
  const [latMin, setLatMin] = useState(0.0);
  const [latHemi, setLatHemi] = useState("N");
  const [lonDeg, setLonDeg] = useState(30);
  const [lonMin, setLonMin] = useState(0.0);
  const [lonHemi, setLonHemi] = useState("W");
  const lat = nauticalToDecimal(latDeg, latMin, latHemi);
  const lon = nauticalToDecimal(lonDeg, lonMin, lonHemi);
  const [marineData, setMarineData] = useState(null);
  const [windData, setWindData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hourIdx, setHourIdx] = useState(0);
  const [lastFetch, setLastFetch] = useState(null);
  const [activeSources, setActiveSources] = useState(["open-meteo-marine", "open-meteo-weather"]);
  const updateShip = (key, val) => setShip(prev => ({ ...prev, [key]: val }));
  const applyPreset = (key) => { setPreset(key); setShip({ ...PRESETS[key] }); };
  const applyLocation = (key) => {
    setLocationKey(key);
    const loc = LOCATIONS[key];
    const nLat = decimalToNautical(loc.lat, true);
    const nLon = decimalToNautical(loc.lon, false);
    setLatDeg(nLat.deg); setLatMin(nLat.min); setLatHemi(nLat.hemi);
    setLonDeg(nLon.deg); setLonMin(nLon.min); setLonHemi(nLon.hemi);
  };

  // ── Computed values ──
  const Tr = calcNaturalRollPeriod(ship.B, ship.GM, ship.d, ship.Lwl);
  const currentMarine = marineData?.[hourIdx];
  const currentWind = windData?.[hourIdx];
  const wavePeriod = currentMarine?.wavePeriod ?? 0;
  const waveHeight = currentMarine?.waveHeight ?? 0;
  const waveDir = currentMarine?.waveDir ?? null;
  const swellPeriod = currentMarine?.swellPeriod ?? 0;
  const swellHeight = currentMarine?.swellHeight ?? 0;
  const swellDir = currentMarine?.swellDir ?? null;
  const relHeading = waveDir != null ? ((waveDir - heading + 360) % 360) : 0;
  const Te_wave = calcEncounterPeriod(wavePeriod, speed, relHeading);
  const Te_swell = calcEncounterPeriod(swellPeriod, speed,
    swellDir != null ? ((swellDir - heading + 360) % 360) : relHeading);
  const paramRatio_wave = calcParametricRiskRatio(Tr, Te_wave);
  const paramRatio_swell = calcParametricRiskRatio(Tr, Te_swell);
  const syncRatio = calcSynchronousRiskRatio(Tr, Te_wave);
  const waveLength = calcWaveLength(wavePeriod);
  const waveLenRatio = ship.Lwl > 0 ? waveLength / ship.Lwl : 0;
  const overallRisk = getRiskLevel(
    paramRatio_wave !== null && paramRatio_swell !== null
      ? (Math.abs(paramRatio_wave - 1) < Math.abs(paramRatio_swell - 1) ? paramRatio_wave : paramRatio_swell)
      : paramRatio_wave ?? paramRatio_swell
  );

  // ── Seakeeping motions ──
  const safeMarine = currentMarine ? sanitizeWxSnapshot(currentMarine) : null;
  const motions = safeMarine ? calcMotions({
    waveHeight_m: safeMarine.waveHeight ?? 0, wavePeriod_s: safeMarine.wavePeriod ?? 8,
    waveDir_deg: safeMarine.waveDir ?? heading,
    swellHeight_m: safeMarine.swellHeight ?? 0, swellPeriod_s: safeMarine.swellPeriod ?? 10,
    swellDir_deg: safeMarine.swellDir ?? heading,
    heading_deg: heading, speed_kts: speed,
    Lwl: ship.Lwl, B: ship.B, GM: ship.GM, Tr,
    rollDamping: ship.rollDamping ?? 0.05,
    bowFreeboard: 6.0, fp_from_midship: 88.0, bridge_from_midship: -70.0,
  }) : null;
  const windSpeed_kts = currentWind?.windSpeed ? currentWind.windSpeed / 1.852 : 0;
  const costFactor = motions ? getSafetyCostFactor(motions, waveHeight, windSpeed_kts) : 1.0;
  const motionStatus = getMotionStatus(motions, waveHeight, windSpeed_kts);
  const speedLossPct = waveHeight > 0
    ? calcKwonSpeedLossPct(waveHeight, waveDir ?? heading, heading, ship.Cb ?? 0.75, ship.Lwl)
    : 0;
  const paramRisk3factor = motions?.paramRisk ?? 0;

  // ── Data fetch ──
  const fetchData = async () => {
    setLoading(true); setError(null);
    const ptBounds = { south: lat - 1, north: lat + 1, west: lon - 1, east: lon + 1 };
    try {
      if (activeSources.includes("open-meteo-marine")) {
        try {
          const cached = cacheGet("marine", ptBounds, 2.0);
          const d = cached ? cached.results[0] : await fetchWeatherData("open-meteo-marine", lat, lon);
          if (!cached) cacheSet("marine", ptBounds, 2.0, [d]);
          setMarineData(d);
        } catch(e) { setError(e.message); }
      }
      if (activeSources.includes("open-meteo-weather")) {
        try {
          const cached = cacheGet("atmo", ptBounds, 2.0);
          if (!cached) await new Promise(r => setTimeout(r, 1200));
          const d = cached ? cached.results[0] : await fetchWeatherData("open-meteo-weather", lat, lon);
          if (!cached) cacheSet("atmo", ptBounds, 2.0, [d]);
          setWindData(d);
        } catch(e) { if (!error) setError(e.message); }
      }
      setLastFetch(new Date()); setHourIdx(0);
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const shipParams = { Tr, speed, relHeading, wavePeriod };

  // ── Tab button helper ──
  const tabBtn = (key, label) => (
    <button onClick={() => setActiveTab(key)} style={{
      padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace",
      background: activeTab === key ? "#F59E0B" : "transparent",
      color: activeTab === key ? "#0F172A" : "#94A3B8",
      borderRadius: "4px 4px 0 0", transition: "all 0.2s",
    }}>{label}</button>
  );

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "linear-gradient(135deg, #0B1120 0%, #0F172A 50%, #111827 100%)",
      color: "#E2E8F0", minHeight: "100vh", padding: 0 }}>

      {/* ─── Header ─── */}
      <div style={{ background: "linear-gradient(90deg, #0F172A, #1E293B, #0F172A)",
        borderBottom: "2px solid #F59E0B", padding: "12px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F59E0B",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 900, color: "#0F172A" }}>{"\u2693"}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.05em", color: "#F8FAFC" }}>PARAMETRIC ROLLING CALCULATOR</div>
            <div style={{ fontSize: 9, color: "#F59E0B", letterSpacing: "0.2em", textTransform: "uppercase" }}>IMO MSC.1/Circ.1228 Compliant Assessment Tool</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {overallRisk.severity >= 3 && marineData && (
            <div style={{ background: overallRisk.color + "20", border: `1px solid ${overallRisk.color}`,
              borderRadius: 4, padding: "4px 12px", color: overallRisk.color, fontSize: 11, fontWeight: 700,
              letterSpacing: "0.1em", animation: overallRisk.severity >= 4 ? "pulse 1.5s infinite" : "none" }}>
              {"\u26a0"} {overallRisk.level} RISK
            </div>
          )}
          {!isFinite(costFactor) && marineData && (
            <div style={{ background: "#7C3AED20", border: "1px solid #7C3AED", borderRadius: 4,
              padding: "4px 12px", color: "#C4B5FD", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.1em", animation: "pulse 1s infinite" }}>{"\ud83d\udeab"} FORBIDDEN CONDITIONS</div>
          )}
          {isFinite(costFactor) && costFactor >= 2 && marineData && (
            <div style={{ background: "#DC262620", border: "1px solid #DC2626", borderRadius: 4,
              padding: "4px 12px", color: "#FCA5A5", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.1em", animation: "pulse 1.5s infinite" }}>{"\u26a0"} DANGEROUS MOTIONS</div>
          )}
          {lastFetch && (<div style={{ color: "#64748B", fontSize: 9 }}>Updated: {lastFetch.toLocaleTimeString()}</div>)}
          <div style={{ color: "#22D3EE", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
            background: "#0F172A", padding: "4px 10px", borderRadius: 4, border: "1px solid #334155",
            lineHeight: 1.5, textAlign: "center" }}>
            <div>{formatNauticalLat(latDeg, latMin, latHemi)}</div>
            <div>{formatNauticalLon(lonDeg, lonMin, lonHemi)}</div>
          </div>
        </div>
      </div>

      {/* ─── Tab bar ─── */}
      <div style={{ padding: "8px 24px 0", display: "flex", gap: 4, flexWrap: "wrap" }}>
        {tabBtn("dashboard", "Dashboard")}
        {tabBtn("vessel", "Vessel Config")}
        {tabBtn("weather", "Weather Sources")}
        {tabBtn("polar", "Polar Analysis")}
        {tabBtn("route", "Route Chart")}
        {tabBtn("reference", "Reference")}
      </div>

      {/* ─── Tab content ─── */}
      <div style={{ padding: "16px 24px" }}>
        {activeTab === "dashboard" && (
          <Dashboard
            latDeg={latDeg} latMin={latMin} latHemi={latHemi}
            setLatDeg={setLatDeg} setLatMin={setLatMin} setLatHemi={setLatHemi}
            lonDeg={lonDeg} lonMin={lonMin} lonHemi={lonHemi}
            setLonDeg={setLonDeg} setLonMin={setLonMin} setLonHemi={setLonHemi}
            locationKey={locationKey} setLocationKey={setLocationKey} applyLocation={applyLocation}
            speed={speed} setSpeed={setSpeed} heading={heading} setHeading={setHeading}
            preset={preset} applyPreset={applyPreset} PRESETS={PRESETS}
            loading={loading} error={error} fetchData={fetchData} lastFetch={lastFetch}
            marineData={marineData} hourIdx={hourIdx} setHourIdx={setHourIdx}
            Tr={Tr} paramRatio_wave={paramRatio_wave} paramRatio_swell={paramRatio_swell}
            syncRatio={syncRatio} waveLength={waveLength} waveLenRatio={waveLenRatio}
            Te_wave={Te_wave} Te_swell={Te_swell} relHeading={relHeading}
            currentMarine={currentMarine} currentWind={currentWind}
            waveHeight={waveHeight} wavePeriod={wavePeriod} waveDir={waveDir}
            swellHeight={swellHeight} swellPeriod={swellPeriod} swellDir={swellDir}
            motions={motions} costFactor={costFactor} motionStatus={motionStatus}
            speedLossPct={speedLossPct} paramRisk3factor={paramRisk3factor}
            shipParams={shipParams}
          />
        )}

        {activeTab === "vessel" && (
          <VesselConfig ship={ship} updateShip={updateShip} Tr={Tr} />
        )}

        {activeTab === "weather" && (
          <div style={{ maxWidth: 700 }}>
            <Panel>
              {sectionHeader("Active Weather Sources")}
              {Object.entries(WEATHER_SOURCES).map(([key, src]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: 12, marginBottom: 8, background: "#0F172A", borderRadius: 6,
                  border: `1px solid ${activeSources.includes(key) ? "#F59E0B50" : "#334155"}` }}>
                  <div>
                    <div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 700 }}>{src.name}</div>
                    <div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>{src.desc}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      {src.free && <span style={{ fontSize: 9, background: "#16A34A30", color: "#16A34A",
                        padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>FREE</span>}
                      <span style={{ fontSize: 9, background: "#3B82F630", color: "#3B82F6",
                        padding: "2px 6px", borderRadius: 3 }}>NO API KEY</span>
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={activeSources.includes(key)}
                      onChange={(e) => { setActiveSources(prev =>
                        e.target.checked ? [...prev, key] : prev.filter(s => s !== key)); }}
                      style={{ accentColor: "#F59E0B", width: 18, height: 18 }} />
                    <span style={{ color: "#94A3B8", fontSize: 11 }}>Active</span>
                  </label>
                </div>
              ))}
            </Panel>
            <Panel style={{ marginTop: 12 }}>
              {sectionHeader("Additional Sources (Coming Soon)")}
              {[
                { name: "NOAA GFS Wave Model", desc: "NOAA Global Forecast System wave data (WAVEWATCH III)", status: "Planned" },
                { name: "Copernicus Marine (CMEMS)", desc: "EU Copernicus Marine Environment Monitoring Service", status: "Planned" },
                { name: "UK Met Office", desc: "Met Office WAVEWATCH III North Atlantic", status: "Planned" },
                { name: "StormGlass.io", desc: "Multi-source aggregated marine data (free tier: 10 req/day)", status: "Planned" },
              ].map((src, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: 12, marginBottom: 8, background: "#0F172A", borderRadius: 6,
                  border: "1px solid #334155", opacity: 0.5 }}>
                  <div>
                    <div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 700 }}>{src.name}</div>
                    <div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>{src.desc}</div>
                  </div>
                  <span style={{ fontSize: 9, background: "#64748B30", color: "#64748B",
                    padding: "2px 8px", borderRadius: 3, fontWeight: 700 }}>{src.status}</span>
                </div>
              ))}
            </Panel>
          </div>
        )}

        {activeTab === "polar" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Panel>
              {sectionHeader("Parametric Roll Risk Polar")}
              <div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8 }}>
                Risk intensity by relative heading angle. Center = maximum danger (ratio = 1.0).
                Based on current wave period of {wavePeriod > 0 ? wavePeriod.toFixed(1) + "s" : "\u2014"}.
              </div>
              <PolarRiskDiagram shipParams={{ ...shipParams, wavePeriod: wavePeriod || 10, Tr }} />
            </Panel>
            <Panel>
              {sectionHeader("Speed / Heading Matrix")}
              <div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8 }}>
                Parametric ratio (T\u1d63 / 2T\u2091) for various speed/heading combinations.
                Tw = {wavePeriod > 0 ? wavePeriod.toFixed(1) + "s" : "10s"}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace" }}>
                  <thead><tr>
                    <th style={{ padding: "4px 6px", color: "#F59E0B", borderBottom: "1px solid #334155",
                      textAlign: "left" }}>Spd\Hdg</th>
                    {[0, 15, 30, 45, 60, 75, 90, 120, 150, 180].map(a => (
                      <th key={a} style={{ padding: "4px 4px", color: "#94A3B8",
                        borderBottom: "1px solid #334155", textAlign: "center" }}>{a}{"\u00b0"}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[4, 8, 12, 16, 20, 24].map(s => (
                      <tr key={s}>
                        <td style={{ padding: "4px 6px", color: "#E2E8F0", fontWeight: 700,
                          borderBottom: "1px solid #1E293B" }}>{s}kt</td>
                        {[0, 15, 30, 45, 60, 75, 90, 120, 150, 180].map(a => {
                          const tw = wavePeriod || 10;
                          const te = calcEncounterPeriod(tw, s, a);
                          const ratio = calcParametricRiskRatio(Tr, te);
                          const risk = getRiskLevel(ratio);
                          return (
                            <td key={a} style={{ padding: "4px 4px", textAlign: "center",
                              background: risk.color + "20", color: risk.color,
                              fontWeight: risk.severity >= 3 ? 800 : 400,
                              borderBottom: "1px solid #1E293B" }}>
                              {ratio !== null && isFinite(ratio) ? ratio.toFixed(2) : "\u221e"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}

        {activeTab === "route" && (
          <div style={{ padding: 0 }}>
            <RouteChart shipParams={{ Tr, speed, heading, Lwl: ship.Lwl, B: ship.B,
              GM: ship.GM, Cb: ship.Cb || 0.75, rollDamping: ship.rollDamping ?? 0.05 }} />
          </div>
        )}

        {activeTab === "reference" && (
          <div style={{ maxWidth: 800 }}>
            <Panel>
              {sectionHeader("Parametric Rolling \u2014 Theory & Formulas")}
              <div style={{ color: "#CBD5E1", fontSize: 12, lineHeight: 1.8 }}>
                <p style={{ marginBottom: 12 }}>
                  <strong style={{ color: "#F59E0B" }}>Parametric rolling</strong> occurs when a vessel navigates in head or following seas where the wave encounter period is approximately <strong>half</strong> the ship's natural roll period (T\u1d63 \u2248 2\u00b7T\u2091). This causes periodic variation of the righting moment (GM fluctuation between wave crest and trough), leading to progressive roll amplification.
                </p>
                <div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}>
                  <div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>KEY FORMULAS</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#E2E8F0", lineHeight: 2 }}>
                    <div><span style={{ color: "#3B82F6" }}>Natural Roll Period:</span> T\u1d63 = 2\u00b7C\u00b7B / \u221aGM</div>
                    <div><span style={{ color: "#3B82F6" }}>C Factor (IMO):</span> C = 0.373 + 0.023\u00b7(B/d) \u2212 0.043\u00b7(Lwl/100)</div>
                    <div><span style={{ color: "#3B82F6" }}>Wave Encounter Period:</span> T\u2091 = Tw / |1 \u2212 V\u00b7cos(\u03b1) / Vw|</div>
                    <div><span style={{ color: "#3B82F6" }}>Wave Speed:</span> Vw = g\u00b7Tw / (2\u03c0)</div>
                    <div><span style={{ color: "#3B82F6" }}>Wave Length:</span> \u03bb = g\u00b7Tw\u00b2 / (2\u03c0)</div>
                    <div><span style={{ color: "#3B82F6" }}>Parametric Ratio:</span> R = T\u1d63 / (2\u00b7T\u2091) \u2014 DANGER when R \u2248 1.0</div>
                    <div><span style={{ color: "#3B82F6" }}>Synchronous Ratio:</span> R = T\u1d63 / T\u2091 \u2014 DANGER when R \u2248 1.0</div>
                  </div>
                </div>
                <div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}>
                  <div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>CONDITIONS FOR PARAMETRIC ROLLING</div>
                  <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                    <div>1. Ship navigating in head/following seas (within ~60\u00b0 of centerline)</div>
                    <div>2. Wave encounter period \u2248 \u00bd natural roll period (T\u1d63 \u2248 2T\u2091)</div>
                    <div>3. Wavelength approximately equal to ship length (\u03bb \u2248 Lwl)</div>
                    <div>4. Sufficient wave height to cause significant GM variation</div>
                    <div>5. Roll damping insufficient to counteract energy input</div>
                    <div style={{ marginTop: 6, color: "#F59E0B" }}><strong>ClassNK Criterion:</strong> (GMmax \u2212 GMmin) / (2\u00b7GM) &gt; threshold value based on damping</div>
                  </div>
                </div>
                <div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}>
                  <div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>RISK LEVELS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                    {[
                      { level: "CRITICAL", range: "|R\u22121| \u2264 0.1", color: "#DC2626" },
                      { level: "HIGH", range: "|R\u22121| \u2264 0.2", color: "#EA580C" },
                      { level: "ELEVATED", range: "|R\u22121| \u2264 0.3", color: "#D97706" },
                      { level: "MODERATE", range: "|R\u22121| \u2264 0.4", color: "#CA8A04" },
                      { level: "LOW", range: "|R\u22121| \u2264 0.5", color: "#16A34A" },
                      { level: "MINIMAL", range: "|R\u22121| > 0.5", color: "#0D9488" },
                    ].map(r => (
                      <div key={r.level} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: r.color }} />
                        <div>
                          <div style={{ color: r.color, fontSize: 10, fontWeight: 700 }}>{r.level}</div>
                          <div style={{ color: "#64748B", fontSize: 9 }}>{r.range}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ background: "#0F172A", borderRadius: 6, padding: 16, border: "1px solid #334155" }}>
                  <div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>PREVENTIVE ACTIONS (IMO MSC.1/Circ.1228)</div>
                  <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                    <div>1. <strong style={{ color: "#E2E8F0" }}>Alter course</strong> \u2014 Change heading to modify encounter period</div>
                    <div>2. <strong style={{ color: "#E2E8F0" }}>Reduce speed</strong> \u2014 Change encounter frequency</div>
                    <div>3. <strong style={{ color: "#E2E8F0" }}>Adjust ballast</strong> \u2014 Modify GM and natural roll period</div>
                    <div>4. <strong style={{ color: "#E2E8F0" }}>Activate stabilizers</strong> \u2014 Fin stabilizers or anti-roll tanks</div>
                    <div>5. <strong style={{ color: "#E2E8F0" }}>Avoid dangerous zones</strong> \u2014 Use polar diagrams for route planning</div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>

      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}*{box-sizing:border-box}input[type="number"]::-webkit-inner-spin-button{opacity:0.5}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0F172A}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}select option{background:#0F172A;color:#E2E8F0}`}</style>
    </div>
  );
}
