// ─── SeaSwellResonanceCheck.jsx — Independent wave & swell resonance analysis ─
// Phase 2, Item 17
// When wave and swell have different periods, checks if EITHER could cause
// parametric rolling independently. The RSS combination in calcMotions masks
// this — this component exposes the dominant danger source.
import { useMemo } from "react";
import {
  calcNaturalRollPeriod, calcEncounterPeriod, calcWaveLength,
  calcParametricRiskRatio, calcSynchronousRiskRatio,
  calcParametricRollRisk, getRiskLevel,
} from "../../physics.js";

function analyseComponent(label, Hs, Tp, dir, heading, speed, Tr, Lwl) {
  if (!Hs || Hs <= 0 || !Tp || Tp <= 0) return null;
  const relHdg = dir != null ? ((dir - heading + 360) % 360) : 0;
  const Te = calcEncounterPeriod(Tp, speed, relHdg);
  const paramRatio = calcParametricRiskRatio(Tr, Te);
  const syncRatio = calcSynchronousRiskRatio(Tr, Te);
  const waveLen = calcWaveLength(Tp);
  const lenRatio = Lwl > 0 ? waveLen / Lwl : 0;
  const risk3f = calcParametricRollRisk(waveLen, Te, Tr, relHdg, Lwl);
  const riskLevel = getRiskLevel(paramRatio);

  // Determine specific danger type
  const isParamResonance = paramRatio !== null && Math.abs(paramRatio - 1) < 0.3;
  const isSyncResonance = syncRatio !== null && Math.abs(syncRatio - 1) < 0.3;
  const isLengthMatch = lenRatio > 0.8 && lenRatio < 1.2;

  return {
    label, Hs, Tp, dir, relHdg, Te, paramRatio, syncRatio,
    waveLen, lenRatio, risk3f, riskLevel,
    isParamResonance, isSyncResonance, isLengthMatch,
    dangerScore: (isParamResonance ? 3 : 0) + (isSyncResonance ? 2 : 0) + (isLengthMatch ? 1 : 0),
  };
}

const RISK_BG = {
  CRITICAL: "#DC262615", HIGH: "#F5970615", ELEVATED: "#F59E0B10",
  MODERATE: "#3B82F610", LOW: "#16A34A08", MINIMAL: "#33415510", UNKNOWN: "#33415510",
};

export default function SeaSwellResonanceCheck({
  waveHeight, wavePeriod, waveDir,
  swellHeight, swellPeriod, swellDir,
  heading, speed, ship,
}) {
  const Tr = ship?.Lwl ? calcNaturalRollPeriod(ship.B, ship.GM, ship.d ?? 12, ship.Lwl) : 0;
  const Lwl = ship?.Lwl ?? 200;

  const components = useMemo(() => {
    const results = [];
    const w = analyseComponent("Wind Waves", waveHeight, wavePeriod, waveDir, heading, speed, Tr, Lwl);
    if (w) results.push(w);
    const s = analyseComponent("Swell", swellHeight, swellPeriod, swellDir, heading, speed, Tr, Lwl);
    if (s) results.push(s);
    return results;
  }, [waveHeight, wavePeriod, waveDir, swellHeight, swellPeriod, swellDir, heading, speed, Tr, Lwl]);

  // Only show if we have at least two components to compare
  if (components.length < 2) return null;

  const dominant = components.reduce((a, b) => a.dangerScore > b.dangerScore ? a : b);
  const hasDualRisk = components.filter(c => c.isParamResonance || c.isSyncResonance).length > 1;
  const hasAnyRisk = components.some(c => c.isParamResonance || c.isSyncResonance);

  return (
    <div style={{
      background: "#1E293B", borderRadius: 8, padding: 14,
      border: `1px solid ${hasDualRisk ? "#DC262650" : hasAnyRisk ? "#F59E0B50" : "#334155"}`,
      fontFamily: "'JetBrains Mono', monospace", marginTop: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ color: "#3B82F6", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>
          SEA / SWELL RESONANCE CHECK
        </div>
        {hasDualRisk && (
          <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3,
            background: "#DC262620", color: "#EF4444", fontWeight: 800, animation: "pulse 2s infinite" }}>
            ⚠ DUAL RESONANCE
          </div>
        )}
        {!hasDualRisk && hasAnyRisk && (
          <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3,
            background: "#F59E0B20", color: "#FBBF24", fontWeight: 700 }}>
            {dominant.label.toUpperCase()} DOMINANT
          </div>
        )}
        {!hasAnyRisk && (
          <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3,
            background: "#16A34A20", color: "#22C55E", fontWeight: 700 }}>
            ✓ NO RESONANCE
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${components.length}, 1fr)`, gap: 10 }}>
        {components.map(c => {
          const bg = RISK_BG[c.riskLevel.level] || "#33415510";
          const color = c.riskLevel.color || "#94A3B8";
          const isDominant = c === dominant && hasAnyRisk;
          return (
            <div key={c.label} style={{
              background: "#0F172A", borderRadius: 6, padding: 10,
              border: `${isDominant ? 2 : 1}px solid ${isDominant ? color : "#33415570"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ color: c.label === "Swell" ? "#F59E0B" : "#3B82F6",
                  fontSize: 10, fontWeight: 800 }}>{c.label}</div>
                <div style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2,
                  background: color + "20", color, fontWeight: 700 }}>
                  {c.riskLevel.level}
                </div>
              </div>

              <div style={{ fontSize: 9, color: "#94A3B8", lineHeight: 1.9 }}>
                <div>Hs: <b style={{ color: "#E2E8F0" }}>{c.Hs?.toFixed(1)}m</b>
                  {" "}Tp: <b style={{ color: "#E2E8F0" }}>{c.Tp?.toFixed(1)}s</b>
                  {" "}Dir: <b style={{ color: "#E2E8F0" }}>{c.dir?.toFixed(0) ?? "—"}°</b></div>
                <div>Te: <b style={{ color: "#22D3EE" }}>{c.Te?.toFixed(1)}s</b>
                  {" "}Rel: <b style={{ color: "#94A3B8" }}>{c.relHdg?.toFixed(0)}°</b></div>
                <div>Param R: <b style={{ color }}>
                  {c.paramRatio !== null && isFinite(c.paramRatio) ? c.paramRatio.toFixed(3) : "∞"}
                </b> {c.isParamResonance && <span style={{ color: "#EF4444", fontWeight: 800 }}>⚠ RESONANCE</span>}</div>
                <div>Sync R: <b style={{ color: c.isSyncResonance ? "#EF4444" : "#94A3B8" }}>
                  {c.syncRatio !== null && isFinite(c.syncRatio) ? c.syncRatio.toFixed(3) : "∞"}
                </b> {c.isSyncResonance && <span style={{ color: "#EF4444", fontWeight: 800 }}>⚠ SYNC</span>}</div>
                <div>λ/L: <b style={{ color: c.isLengthMatch ? "#F59E0B" : "#94A3B8" }}>
                  {(c.lenRatio||0).toFixed(2)}
                </b> {c.isLengthMatch && <span style={{ color: "#F59E0B" }}>≈ 1.0</span>}</div>
                <div>3-Factor: <b style={{ color }}>{((c.risk3f??0)*100).toFixed(0)}%</b></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interpretation note */}
      {hasAnyRisk && (
        <div style={{ marginTop: 8, padding: "6px 8px", background: "#0F172A",
          borderRadius: 4, border: "1px solid #334155", fontSize: 9, color: "#94A3B8", lineHeight: 1.6 }}>
          {hasDualRisk ? (
            <><b style={{ color: "#EF4444" }}>BOTH wave and swell</b> independently produce
            near-resonant conditions. The combined effect is more dangerous than either alone.
            Course alteration must account for both wave systems.</>
          ) : (
            <><b style={{ color: dominant.riskLevel.color }}>{dominant.label}</b> is the
            dominant resonance source (Tp={dominant.Tp?.toFixed(1)}s,
            Te={dominant.Te?.toFixed(1)}s → Tr/2Te = {dominant.paramRatio?.toFixed(2)}).
            {dominant.label === "Swell" ?
              " Swell resonance persists longer than wind-wave — monitor even if wind eases." :
              " Wind-wave resonance may ease as conditions change."}</>
          )}
        </div>
      )}

      {/* Tr reference */}
      <div style={{ marginTop: 6, fontSize: 8, color: "#475569", textAlign: "right" }}>
        Tᵣ = {Tr?.toFixed(1)}s (natural roll period)
      </div>
    </div>
  );
}
