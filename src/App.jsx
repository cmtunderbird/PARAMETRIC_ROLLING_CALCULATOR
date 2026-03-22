import { useCallback, useState, useEffect } from "react";
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

// ── Centralised state store (Phase 1, Item 3) ──
import { useAppState, useAppActions, PRESETS } from "./state/appStore.jsx";

// ── Extracted UI components ──
import Dashboard, { LOCATIONS } from "./ui/Dashboard.jsx";
import VesselConfig from "./ui/VesselConfig.jsx";
import DecisionBrief from "./ui/DecisionBrief.jsx";
import {
  PolarRiskDiagram, inputStyle, sectionHeader, Panel, ErrorBoundary,
  StaleDataBanner, ManualWeatherEntry, ResumeSessionDialog,
  nauticalToDecimal, formatNauticalLat, formatNauticalLon,
} from "./ui/components/index.js";

// ── Weather providers (Phase 1, Item 4) ──
import { OPEN_METEO_SOURCES, fetchOpenMeteo } from "./weather/providers/index.js";
import { saveSession } from "./services/sessionStore.js";
// Alias for backward compat with Weather Sources tab
const WEATHER_SOURCES = OPEN_METEO_SOURCES;
async function fetchWeatherData(sourceKey, lat, lon) {
  return fetchOpenMeteo(sourceKey, lat, lon, 7);
}

// ─── Main App — reads from centralised store ────────────────────────────────
export default function ParametricRollingCalculator() {
  const state = useAppState();
  const actions = useAppActions();
  const { activeTab, preset, ship, speed, heading, locationKey,
    latDeg, latMin, latHemi, lonDeg, lonMin, lonHemi,
    marineData, windData, loading, error, hourIdx, lastFetch, activeSources } = state;

  const lat = nauticalToDecimal(latDeg, latMin, latHemi);
  const lon = nauticalToDecimal(lonDeg, lonMin, lonHemi);

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
      : paramRatio_wave ?? paramRatio_swell);

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
    bowFreeboard: ship.bowFreeboard ?? 6.0,
    fp_from_midship: ship.fp_from_midship ?? (ship.Lwl / 2),
    bridge_from_midship: ship.bridge_from_midship ?? -(ship.Lwl * 0.4),
  }) : null;
  const windSpeed_kts = currentWind?.windSpeed ? currentWind.windSpeed / 1.852 : 0;
  const costFactor = motions ? getSafetyCostFactor(motions, waveHeight, windSpeed_kts) : 1.0;
  const motionStatus = getMotionStatus(motions, waveHeight, windSpeed_kts);
  const speedLossPct = waveHeight > 0 ? calcKwonSpeedLossPct(waveHeight, waveDir ?? heading, heading, ship.Cb ?? 0.75, ship.Lwl) : 0;
  const paramRisk3factor = motions?.paramRisk ?? 0;

  // ── Data fetch — dispatches to store ──
  const fetchData = useCallback(async () => {
    actions.fetchStart();
    const ptBounds = { south: lat - 1, north: lat + 1, west: lon - 1, east: lon + 1 };
    let marine = null, wind = null, err = null;
    try {
      if (activeSources.includes("open-meteo-marine")) {
        try {
          const cached = cacheGet("marine", ptBounds, 2.0);
          const d = cached ? cached.results[0] : await fetchWeatherData("open-meteo-marine", lat, lon);
          if (!cached) cacheSet("marine", ptBounds, 2.0, [d]);
          marine = d;
        } catch(e) { err = e.message; }
      }
      if (activeSources.includes("open-meteo-weather")) {
        try {
          const cached = cacheGet("atmo", ptBounds, 2.0);
          if (!cached) await new Promise(r => setTimeout(r, 1200));
          const d = cached ? cached.results[0] : await fetchWeatherData("open-meteo-weather", lat, lon);
          if (!cached) cacheSet("atmo", ptBounds, 2.0, [d]);
          wind = d;
        } catch(e) { if (!err) err = e.message; }
      }
      if (err) actions.fetchError(err);
      else actions.fetchDone(marine, wind);
    } catch(e) { actions.fetchError(e.message); }
  }, [lat, lon, activeSources, actions]);

  const shipParams = { Tr, speed, relHeading, wavePeriod };

  // ── Offline / stale-cache indicators (Phase 1, Item 8) ──
  const dataAgeMinutes = lastFetch ? (Date.now() - lastFetch.getTime()) / 60000 : null;
  const isStale = dataAgeMinutes !== null && dataAgeMinutes > 30;
  const isOffline = !!error && !marineData;
  const handleManualWeather = useCallback((marine, wind) => {
    actions.fetchDone(marine, wind);
  }, [actions]);

  // ── Session persistence (Phase 1, Item 10) ──
  const [showResume, setShowResume] = useState(true);
  useEffect(() => {
    if (!marineData || !lastFetch) return;
    saveSession({
      vesselName: ship.name || PRESETS[preset]?.name || "Custom",
      position: `${latDeg}°${latMin.toFixed(1)}'${latHemi} ${lonDeg}°${lonMin.toFixed(1)}'${lonHemi}`,
      hasWeather: !!marineData,
      hasRoute: false, // will be true when route state moves to store
      marineData, windData, preset, lastFetch: lastFetch.toISOString(),
    }).catch(() => {});
  }, [marineData, windData, lastFetch]);

  const handleResume = useCallback((session) => {
    setShowResume(false);
    if (session.marineData) actions.fetchDone(session.marineData, session.windData);
    if (session.preset && PRESETS[session.preset]) actions.applyPreset(session.preset);
  }, [actions]);
  const handleStartFresh = useCallback(() => setShowResume(false), []);

  // ── Adapter functions for child components ──
  const setLatDeg = v => actions.setLat({ deg: v });
  const setLatMin = v => actions.setLat({ min: v });
  const setLatHemi = v => actions.setLat({ hemi: v });
  const setLonDeg = v => actions.setLon({ deg: v });
  const setLonMin = v => actions.setLon({ min: v });
  const setLonHemi = v => actions.setLon({ hemi: v });
  const applyLocation = (key) => { const loc = LOCATIONS[key]; actions.applyLocation(key, loc.lat, loc.lon); };

  const tabBtn = (key, label) => (
    <button onClick={() => actions.setTab(key)} style={{
      padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace",
      background: activeTab === key ? "#F59E0B" : "transparent",
      color: activeTab === key ? "#0F172A" : "#94A3B8",
      borderRadius: "4px 4px 0 0", transition: "all 0.2s",
    }}>{label}</button>
  );

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "linear-gradient(135deg, #0B1120 0%, #0F172A 50%, #111827 100%)", color: "#E2E8F0", minHeight: "100vh", padding: 0 }}>
      {showResume && <ResumeSessionDialog onResume={handleResume} onStartFresh={handleStartFresh} />}
      {/* ─ Header ─ */}
      <div style={{ background: "linear-gradient(90deg, #0F172A, #1E293B, #0F172A)", borderBottom: "2px solid #F59E0B", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#0F172A" }}>⚓</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.05em", color: "#F8FAFC" }}>PARAMETRIC ROLLING CALCULATOR</div>
            <div style={{ fontSize: 9, color: "#F59E0B", letterSpacing: "0.2em", textTransform: "uppercase" }}>IMO MSC.1/Circ.1228 Compliant Assessment Tool</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {overallRisk.severity >= 3 && marineData && (<div style={{ background: overallRisk.color + "20", border: `1px solid ${overallRisk.color}`, borderRadius: 4, padding: "4px 12px", color: overallRisk.color, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", animation: overallRisk.severity >= 4 ? "pulse 1.5s infinite" : "none" }}>⚠ {overallRisk.level} RISK</div>)}
          {!isFinite(costFactor) && marineData && (<div style={{ background: "#7C3AED20", border: "1px solid #7C3AED", borderRadius: 4, padding: "4px 12px", color: "#C4B5FD", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", animation: "pulse 1s infinite" }}>🚫 FORBIDDEN CONDITIONS</div>)}
          {isFinite(costFactor) && costFactor >= 2 && marineData && (<div style={{ background: "#DC262620", border: "1px solid #DC2626", borderRadius: 4, padding: "4px 12px", color: "#FCA5A5", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", animation: "pulse 1.5s infinite" }}>⚠ DANGEROUS MOTIONS</div>)}
          {lastFetch && (<div style={{ color: "#64748B", fontSize: 9 }}>Updated: {lastFetch.toLocaleTimeString()}</div>)}
          <div style={{ color: "#22D3EE", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", background: "#0F172A", padding: "4px 10px", borderRadius: 4, border: "1px solid #334155", lineHeight: 1.5, textAlign: "center" }}>
            <div>{formatNauticalLat(latDeg, latMin, latHemi)}</div>
            <div>{formatNauticalLon(lonDeg, lonMin, lonHemi)}</div>
          </div>
        </div>
      </div>
      {/* ─ Tab bar ─ */}
      <div style={{ padding: "8px 24px 0", display: "flex", gap: 4, flexWrap: "wrap" }}>
        {tabBtn("dashboard", "Dashboard")}{tabBtn("vessel", "Vessel Config")}{tabBtn("weather", "Weather Sources")}{tabBtn("polar", "Polar Analysis")}{tabBtn("route", "Route Chart")}{tabBtn("reference", "Reference")}
      </div>
      {/* ─ Tab content ─ */}
      <div style={{ padding: "16px 24px" }}>
        {activeTab === "dashboard" && (
          <ErrorBoundary name="Dashboard">
          <StaleDataBanner lastFetch={lastFetch} dataAgeMinutes={dataAgeMinutes} isStale={isStale} isOffline={isOffline} />
          {isOffline && <ManualWeatherEntry onApply={handleManualWeather} />}
          {marineData && <DecisionBrief
            waveHeight_m={waveHeight} wavePeriod_s={wavePeriod} waveDir_deg={waveDir}
            swellHeight_m={swellHeight} swellPeriod_s={swellPeriod} swellDir_deg={swellDir}
            windSpeed_kts={windSpeed_kts} ship={ship}
            currentHeading={heading} currentSpeed={speed}
          />}
          <Dashboard
            latDeg={latDeg} latMin={latMin} latHemi={latHemi} setLatDeg={setLatDeg} setLatMin={setLatMin} setLatHemi={setLatHemi}
            lonDeg={lonDeg} lonMin={lonMin} lonHemi={lonHemi} setLonDeg={setLonDeg} setLonMin={setLonMin} setLonHemi={setLonHemi}
            locationKey={locationKey} setLocationKey={k => actions.applyLocation(k, LOCATIONS[k]?.lat, LOCATIONS[k]?.lon)} applyLocation={applyLocation}
            speed={speed} setSpeed={actions.setSpeed} heading={heading} setHeading={actions.setHeading}
            preset={preset} applyPreset={actions.applyPreset} PRESETS={PRESETS}
            loading={loading} error={error} fetchData={fetchData} lastFetch={lastFetch}
            marineData={marineData} hourIdx={hourIdx} setHourIdx={actions.setHourIdx}
            Tr={Tr} paramRatio_wave={paramRatio_wave} paramRatio_swell={paramRatio_swell}
            syncRatio={syncRatio} waveLength={waveLength} waveLenRatio={waveLenRatio}
            Te_wave={Te_wave} Te_swell={Te_swell} relHeading={relHeading}
            currentMarine={currentMarine} currentWind={currentWind}
            waveHeight={waveHeight} wavePeriod={wavePeriod} waveDir={waveDir}
            swellHeight={swellHeight} swellPeriod={swellPeriod} swellDir={swellDir}
            motions={motions} costFactor={costFactor} motionStatus={motionStatus}
            speedLossPct={speedLossPct} paramRisk3factor={paramRisk3factor} shipParams={shipParams}
          />
          </ErrorBoundary>
        )}
        {activeTab === "vessel" && <ErrorBoundary name="Vessel Config"><VesselConfig ship={ship} updateShip={actions.updateShip} Tr={Tr} /></ErrorBoundary>}
        {activeTab === "weather" && (
          <ErrorBoundary name="Weather Sources">
          <div style={{ maxWidth: 700 }}>
            <Panel>{sectionHeader("Active Weather Sources")}
              {Object.entries(WEATHER_SOURCES).map(([key, src]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, marginBottom: 8, background: "#0F172A", borderRadius: 6, border: `1px solid ${activeSources.includes(key) ? "#F59E0B50" : "#334155"}` }}>
                  <div>
                    <div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 700 }}>{src.name}</div>
                    <div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>{src.desc}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      {src.free && <span style={{ fontSize: 9, background: "#16A34A30", color: "#16A34A", padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>FREE</span>}
                      <span style={{ fontSize: 9, background: "#3B82F630", color: "#3B82F6", padding: "2px 6px", borderRadius: 3 }}>NO API KEY</span>
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={activeSources.includes(key)}
                      onChange={(e) => actions.setActiveSources(e.target.checked ? [...activeSources, key] : activeSources.filter(s => s !== key))}
                      style={{ accentColor: "#F59E0B", width: 18, height: 18 }} />
                    <span style={{ color: "#94A3B8", fontSize: 11 }}>Active</span>
                  </label>
                </div>
              ))}
            </Panel>
            <Panel style={{ marginTop: 12 }}>{sectionHeader("Additional Sources (Coming Soon)")}
              {[{ name: "NOAA GFS Wave Model", desc: "NOAA Global Forecast System wave data (WAVEWATCH III)", status: "Planned" },
                { name: "Copernicus Marine (CMEMS)", desc: "EU Copernicus Marine Environment Monitoring Service", status: "Planned" },
                { name: "UK Met Office", desc: "Met Office WAVEWATCH III North Atlantic", status: "Planned" },
                { name: "StormGlass.io", desc: "Multi-source aggregated marine data (free tier: 10 req/day)", status: "Planned" },
              ].map((src, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, marginBottom: 8, background: "#0F172A", borderRadius: 6, border: "1px solid #334155", opacity: 0.5 }}>
                  <div><div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 700 }}>{src.name}</div><div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>{src.desc}</div></div>
                  <span style={{ fontSize: 9, background: "#64748B30", color: "#64748B", padding: "2px 8px", borderRadius: 3, fontWeight: 700 }}>{src.status}</span>
                </div>
              ))}
            </Panel>
          </div>
          </ErrorBoundary>
        )}
        {activeTab === "polar" && (
          <ErrorBoundary name="Polar Analysis">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Panel>{sectionHeader("Parametric Roll Risk Polar")}
              <div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8 }}>Risk intensity by relative heading angle. Center = maximum danger (ratio = 1.0). Based on current wave period of {wavePeriod > 0 ? wavePeriod.toFixed(1) + "s" : "—"}.</div>
              <PolarRiskDiagram shipParams={{ ...shipParams, wavePeriod: wavePeriod || 10, Tr }} />
            </Panel>
            <Panel>{sectionHeader("Speed / Heading Matrix")}
              <div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8 }}>Parametric ratio (Tᵣ / 2Tₑ) for various speed/heading combinations. Tw = {wavePeriod > 0 ? wavePeriod.toFixed(1) + "s" : "10s"}</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                  <thead><tr><th style={{ padding: "4px 6px", color: "#F59E0B", borderBottom: "1px solid #334155", textAlign: "left" }}>Spd\Hdg</th>
                    {[0,15,30,45,60,75,90,120,150,180].map(a => <th key={a} style={{ padding: "4px 4px", color: "#94A3B8", borderBottom: "1px solid #334155", textAlign: "center" }}>{a}°</th>)}
                  </tr></thead>
                  <tbody>{[4,8,12,16,20,24].map(s => <tr key={s}><td style={{ padding: "4px 6px", color: "#E2E8F0", fontWeight: 700, borderBottom: "1px solid #1E293B" }}>{s}kt</td>
                    {[0,15,30,45,60,75,90,120,150,180].map(a => { const tw=wavePeriod||10; const te=calcEncounterPeriod(tw,s,a); const ratio=calcParametricRiskRatio(Tr,te); const risk=getRiskLevel(ratio);
                      return <td key={a} style={{ padding: "4px 4px", textAlign: "center", background: risk.color+"20", color: risk.color, fontWeight: risk.severity>=3?800:400, borderBottom: "1px solid #1E293B" }}>{ratio!==null&&isFinite(ratio)?ratio.toFixed(2):"∞"}</td>; })}
                  </tr>)}</tbody>
                </table>
              </div>
            </Panel>
          </div>
          </ErrorBoundary>
        )}
        {activeTab === "route" && <div style={{ padding: 0 }}><ErrorBoundary name="Route Chart"><RouteChart shipParams={{ Tr, speed, heading, Lwl: ship.Lwl, B: ship.B, GM: ship.GM, Cb: ship.Cb || 0.75, rollDamping: ship.rollDamping ?? 0.05 }} /></ErrorBoundary></div>}
        {activeTab === "reference" && (
          <div style={{ maxWidth: 800 }}><Panel>{sectionHeader("Parametric Rolling — Theory & Formulas")}
            <div style={{ color: "#CBD5E1", fontSize: 12, lineHeight: 1.8 }}>
              <p style={{ marginBottom: 12 }}><strong style={{ color: "#F59E0B" }}>Parametric rolling</strong> occurs when a vessel navigates in head or following seas where the wave encounter period is approximately <strong>half</strong> the ship's natural roll period (Tᵣ ≈ 2·Tₑ). This causes periodic variation of the righting moment (GM fluctuation between wave crest and trough), leading to progressive roll amplification.</p>
              <div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}>
                <div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>KEY FORMULAS</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#E2E8F0", lineHeight: 2 }}>
                  <div><span style={{ color: "#3B82F6" }}>Natural Roll Period:</span> Tᵣ = 2·C·B / √GM</div>
                  <div><span style={{ color: "#3B82F6" }}>C Factor (IMO):</span> C = 0.373 + 0.023·(B/d) − 0.043·(Lwl/100)</div>
                  <div><span style={{ color: "#3B82F6" }}>Parametric Ratio:</span> R = Tᵣ / (2·Tₑ) — DANGER when R ≈ 1.0</div>
                </div>
              </div>
              <div style={{ background: "#0F172A", borderRadius: 6, padding: 16, border: "1px solid #334155" }}>
                <div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>PREVENTIVE ACTIONS (IMO MSC.1/Circ.1228)</div>
                <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                  <div>1. <strong style={{ color: "#E2E8F0" }}>Alter course</strong> — Change heading to modify encounter period</div>
                  <div>2. <strong style={{ color: "#E2E8F0" }}>Reduce speed</strong> — Change encounter frequency</div>
                  <div>3. <strong style={{ color: "#E2E8F0" }}>Adjust ballast</strong> — Modify GM and natural roll period</div>
                  <div>4. <strong style={{ color: "#E2E8F0" }}>Activate stabilizers</strong> — Fin stabilizers or anti-roll tanks</div>
                  <div>5. <strong style={{ color: "#E2E8F0" }}>Avoid dangerous zones</strong> — Use polar diagrams for route planning</div>
                </div>
              </div>
            </div>
          </Panel></div>
        )}
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}*{box-sizing:border-box}input[type="number"]::-webkit-inner-spin-button{opacity:0.5}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0F172A}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}select option{background:#0F172A;color:#E2E8F0}`}</style>
    </div>
  );
}
