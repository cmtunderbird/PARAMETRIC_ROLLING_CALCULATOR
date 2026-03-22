// ─── Dashboard.jsx — Main risk assessment dashboard ──────────────────────────
// Extracted from App.jsx — Phase 1, Item 1
// Receives all state/computed values as props from App.jsx
import {
  RiskGauge, CompassRose, TimelineChart, Field,
  NauticalCoordInput, sectionHeader, statBox, Panel,
  formatNauticalLat, formatNauticalLon, inputStyle, labelStyle,
} from "./components/index.js";
import { G, DEG_TO_RAD, SafetyLimits } from "../physics.js";

const LOCATIONS = {
  "North Atlantic": { lat: 50.0, lon: -30.0 },
  "North Pacific": { lat: 45.0, lon: -170.0 },
  "South China Sea": { lat: 15.0, lon: 115.0 },
  "Bay of Biscay": { lat: 45.5, lon: -5.0 },
  "Mediterranean": { lat: 36.0, lon: 18.0 },
  "Indian Ocean": { lat: -10.0, lon: 70.0 },
  "Southern Ocean": { lat: -50.0, lon: 0.0 },
  "Tasman Sea": { lat: -38.0, lon: 160.0 },
  "Gulf of Mexico": { lat: 25.0, lon: -90.0 },
  "Arabian Sea": { lat: 15.0, lon: 62.0 },
};

export { LOCATIONS };

export default function Dashboard({
  latDeg, latMin, latHemi, setLatDeg, setLatMin, setLatHemi,
  lonDeg, lonMin, lonHemi, setLonDeg, setLonMin, setLonHemi,
  locationKey, setLocationKey, applyLocation,
  speed, setSpeed, heading, setHeading, preset, applyPreset, PRESETS,
  loading, error, fetchData, lastFetch,
  marineData, hourIdx, setHourIdx,
  Tr, paramRatio_wave, paramRatio_swell, syncRatio,
  waveLength, waveLenRatio,
  Te_wave, Te_swell, relHeading,
  currentMarine, currentWind, waveHeight, wavePeriod, waveDir,
  swellHeight, swellPeriod, swellDir,
  motions, costFactor, motionStatus, speedLossPct, paramRisk3factor,
  shipParams,
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
      {/* ─── Column 1: Position & Voyage ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel>
          {sectionHeader("Ship's Position & Fetch")}
          <NauticalCoordInput label="Latitude" deg={latDeg} min={latMin} hemi={latHemi}
            onDegChange={setLatDeg} onMinChange={setLatMin} onHemiChange={setLatHemi} isLat={true} />
          <NauticalCoordInput label="Longitude" deg={lonDeg} min={lonMin} hemi={lonHemi}
            onDegChange={setLonDeg} onMinChange={setLonMin} onHemiChange={setLonHemi} isLat={false} />
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Quick Location</label>
            <select value={locationKey} onChange={(e) => applyLocation(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}>
              {Object.keys(LOCATIONS).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <button onClick={fetchData} disabled={loading} style={{
            width: "100%", padding: "10px", border: "none", borderRadius: 4,
            background: loading ? "#334155" : "linear-gradient(90deg, #F59E0B, #D97706)",
            color: "#0F172A", fontWeight: 800, fontSize: 12, cursor: loading ? "wait" : "pointer",
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", transition: "all 0.3s",
          }}>{loading ? "FETCHING DATA..." : "\u27f3  FETCH WEATHER DATA"}</button>
          {error && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 6, padding: 6,
            background: "#7F1D1D20", borderRadius: 4 }}>{error}</div>}
        </Panel>

        <Panel>
          {sectionHeader("Voyage Parameters")}
          <Field label="Ship Speed" value={speed} onChange={setSpeed} unit="kts" step={0.5} min={0} max={30} />
          <Field label="Ship Heading" value={heading} onChange={setHeading} unit="\u00b0 True" step={1} min={0} max={359} />
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Vessel Preset</label>
            <select value={preset} onChange={(e) => applyPreset(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}>
              {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
        </Panel>
      </div>

      {/* ─── Column 2: Risk Assessment & Seakeeping ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel>
          {sectionHeader("Parametric Roll Assessment")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <RiskGauge value={paramRatio_wave} label="Wave Param. Ratio (T\u1d63/2T\u2091)" />
            <RiskGauge value={paramRatio_swell} label="Swell Param. Ratio (T\u1d63/2T\u2091)" />
          </div>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            <RiskGauge value={syncRatio} label="Synchronous Ratio (T\u1d63/T\u2091)" />
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ color: "#94A3B8", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>\u03bb / L Ratio</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                color: waveLenRatio > 0.8 && waveLenRatio < 1.3 ? "#DC2626" : waveLenRatio > 0.6 && waveLenRatio < 1.5 ? "#D97706" : "#16A34A" }}>
                {waveLenRatio > 0 ? waveLenRatio.toFixed(2) : "---"}
              </div>
              <div style={{ color: "#64748B", fontSize: 9, marginTop: 2 }}>
                {waveLenRatio > 0.8 && waveLenRatio < 1.3 ? "\u26a0 DANGER: \u03bb \u2248 L" : waveLenRatio > 0.6 && waveLenRatio < 1.5 ? "CAUTION" : "OK"}
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          {sectionHeader("Computed Values")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
            {statBox("Nat. Roll T\u1d63", Tr, "s", "#3B82F6")}
            {statBox("Enc. T\u2091 Wave", Te_wave, "s", "#F59E0B")}
            {statBox("Enc. T\u2091 Swell", Te_swell, "s", "#A855F7")}
            {statBox("Wave \u03bb", waveLength, "m", "#22D3EE")}
            {statBox("Rel. Heading", relHeading, "\u00b0")}
            {statBox("Wave Speed", wavePeriod > 0 ? (G * wavePeriod / (2 * Math.PI)) : 0, "m/s", "#10B981")}
          </div>
        </Panel>

        <Panel>
          {sectionHeader("\u2693 Seakeeping Assessment")}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 10, padding: "6px 10px", borderRadius: 5,
            border: `1px solid ${motionStatus.color}`, background: motionStatus.color + "18" }}>
            <span style={{ color: motionStatus.color, fontWeight: 800, fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.12em" }}>
              {!isFinite(costFactor) ? "\ud83d\udeab" : costFactor >= 2 ? "\u26a0" : costFactor > 1 ? "\u26a1" : "\u2713"} {motionStatus.label}
            </span>
            <span style={{ color: "#94A3B8", fontSize: 10 }}>cost\u00d7{isFinite(costFactor) ? costFactor.toFixed(2) : "\u221e"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
            {statBox("Roll Amp", motions ? motions.roll.toFixed(1) : "\u2014", "\u00b0",
              motions && motions.roll >= SafetyLimits.maxRollDangerous ? "#DC2626"
              : motions && motions.roll >= SafetyLimits.maxRollSafe ? "#D97706" : "#22D3EE")}
            {statBox("Pitch Amp", motions ? motions.pitch.toFixed(1) : "\u2014", "\u00b0",
              motions && motions.pitch >= SafetyLimits.maxPitchDangerous ? "#DC2626"
              : motions && motions.pitch >= SafetyLimits.maxPitchSafe ? "#D97706" : "#22D3EE")}
            {statBox("Bridge Acc", motions ? motions.bridgeAcc.toFixed(2) : "\u2014", "m/s\u00b2",
              motions && motions.bridgeAcc >= SafetyLimits.maxAccelDangerous ? "#DC2626"
              : motions && motions.bridgeAcc >= SafetyLimits.maxAccelSafe ? "#D97706" : "#10B981")}
            {statBox("Slam Prob", motions ? (motions.slam * 100).toFixed(1) : "\u2014", "%",
              motions && motions.slam >= SafetyLimits.maxSlamMarginal ? "#DC2626"
              : motions && motions.slam >= SafetyLimits.maxSlamSafe ? "#D97706" : "#10B981")}
            {statBox("Green Water", motions ? (motions.greenWater * 100).toFixed(1) : "\u2014", "%",
              motions && motions.greenWater > 0.10 ? "#EA580C" : "#10B981")}
            {statBox("Speed Loss", speedLossPct.toFixed(1), "%", speedLossPct > 15 ? "#EA580C" : "#94A3B8")}
          </div>
          <div style={{ marginTop: 10, padding: "6px 8px", background: "#0F172A", borderRadius: 4, border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ color: "#94A3B8", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em" }}>Parametric Risk (3-factor)</span>
              <span style={{ color: paramRisk3factor > 0.7 ? "#DC2626" : paramRisk3factor > 0.4 ? "#D97706" : "#16A34A",
                fontWeight: 800, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                {(paramRisk3factor * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ background: "#1E293B", borderRadius: 3, height: 6 }}>
              <div style={{ height: 6, borderRadius: 3, width: `${Math.min(paramRisk3factor * 100, 100)}%`,
                background: paramRisk3factor > 0.7 ? "#DC2626" : paramRisk3factor > 0.4 ? "#D97706" : "#16A34A",
                transition: "width 0.4s ease" }} />
            </div>
            <div style={{ color: "#475569", fontSize: 9, marginTop: 3 }}>Period \u00d7 Length \u00d7 Heading resonance factors (windmar model)</div>
          </div>
        </Panel>
      </div>

      {/* ─── Column 3: Compass & Sea State ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel>
          {sectionHeader("Directional Overview")}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <CompassRose waveDir={waveDir} swellDir={swellDir} shipHeading={heading} />
          </div>
        </Panel>

        <Panel>
          {sectionHeader("Current Sea State")}
          <div style={{ textAlign: "center", marginBottom: 8, padding: "6px 8px", background: "#0F172A", borderRadius: 4, border: "1px solid #334155" }}>
            <div style={{ color: "#64748B", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 3 }}>Ship's Position</div>
            <div style={{ color: "#22D3EE", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>{formatNauticalLat(latDeg, latMin, latHemi)}</div>
            <div style={{ color: "#22D3EE", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>{formatNauticalLon(lonDeg, lonMin, lonHemi)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {statBox("Hs Wave", waveHeight, "m", "#3B82F6")}
            {statBox("Tw Wave", wavePeriod, "s", "#3B82F6")}
            {statBox("Hs Swell", swellHeight, "m", "#F59E0B")}
            {statBox("Tw Swell", swellPeriod, "s", "#F59E0B")}
            {currentWind && <>{statBox("Wind", currentWind.windSpeed, "km/h", "#22D3EE")}{statBox("Gusts", currentWind.windGusts, "km/h", "#EF4444")}</>}
          </div>
          {currentMarine && (
            <div style={{ color: "#64748B", fontSize: 9, textAlign: "center", marginTop: 8 }}>
              {new Date(currentMarine.time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
        </Panel>
      </div>

      {/* ─── Full-width: Timeline ─── */}
      <div style={{ gridColumn: "1 / -1" }}>
        <Panel>
          {sectionHeader("7-Day Forecast Timeline \u2014 Click to Select Hour")}
          {marineData ? (<>
            <TimelineChart data={marineData} shipParams={shipParams} hourOffset={hourIdx} onHourChange={setHourIdx} />
            <div style={{ textAlign: "center", marginTop: 6 }}>
              <input type="range" min={0} max={marineData.length - 1} value={hourIdx}
                onChange={(e) => setHourIdx(parseInt(e.target.value))}
                style={{ width: "90%", accentColor: "#F59E0B" }} />
              <div style={{ color: "#94A3B8", fontSize: 10, marginTop: 2 }}>
                Hour {hourIdx} \u2014 {currentMarine && new Date(currentMarine.time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            </div>
          </>) : (
            <div style={{ textAlign: "center", color: "#64748B", padding: 30, fontSize: 12 }}>
              Fetch weather data to view the forecast timeline
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
