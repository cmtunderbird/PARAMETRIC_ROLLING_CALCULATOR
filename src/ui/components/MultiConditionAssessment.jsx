// ─── MultiConditionAssessment.jsx — Laden vs Ballast risk comparison ─────────
// Phase 2, Item 16
// Assesses risk for both laden and ballast conditions simultaneously,
// showing which condition is more vulnerable. Many vessels have dramatically
// different roll characteristics between conditions.
import { useMemo } from "react";
import {
  calcNaturalRollPeriod, calcEncounterPeriod,
  calcParametricRiskRatio, calcMotions,
  getSafetyCostFactor, getRiskLevel,
} from "../../physics.js";
import vesselProfiles from "../../core/vesselProfiles.json";

function assessCondition(condParams, baseShip, seaState) {
  const ship = { ...baseShip, ...condParams };
  const Tr = calcNaturalRollPeriod(ship.B, ship.GM, ship.d, ship.Lwl);
  const relHdg = seaState.waveDir != null
    ? ((seaState.waveDir - seaState.heading + 360) % 360) : 0;
  const Te = calcEncounterPeriod(seaState.wavePeriod, seaState.speed, relHdg);
  const paramRatio = calcParametricRiskRatio(Tr, Te);
  const risk = getRiskLevel(paramRatio);

  const motions = calcMotions({
    waveHeight_m: seaState.waveHeight, wavePeriod_s: seaState.wavePeriod,
    waveDir_deg: seaState.waveDir ?? seaState.heading,
    swellHeight_m: seaState.swellHeight ?? 0, swellPeriod_s: seaState.swellPeriod ?? 10,
    swellDir_deg: seaState.swellDir ?? seaState.heading,
    heading_deg: seaState.heading, speed_kts: seaState.speed,
    Lwl: ship.Lwl, B: ship.B, GM: ship.GM, Tr,
    rollDamping: ship.rollDamping ?? 0.05,
    bowFreeboard: ship.bowFreeboard ?? 6.0,
    fp_from_midship: ship.fp_from_midship ?? (ship.Lwl / 2),
    bridge_from_midship: ship.bridge_from_midship ?? -(ship.Lwl * 0.4),
  });

  const costFactor = motions
    ? getSafetyCostFactor(motions, seaState.waveHeight, seaState.windSpeed_kts ?? 0)
    : 1.0;

  return { Tr, paramRatio, risk, costFactor, motions, ship,
    zone: costFactor <= 1.2 ? "safe" : costFactor <= 2.0 ? "marginal"
      : isFinite(costFactor) ? "dangerous" : "forbidden" };
}

const ZONE_COLORS = {
  safe: "#16A34A", marginal: "#F59E0B", dangerous: "#DC2626", forbidden: "#7C3AED",
};

export default function MultiConditionAssessment({
  preset, ship, waveHeight, wavePeriod, waveDir,
  swellHeight, swellPeriod, swellDir,
  heading, speed, windSpeed_kts,
}) {
  const profile = vesselProfiles[preset];
  const conditions = profile?.conditions;

  // Need at least two conditions to compare
  if (!conditions || Object.keys(conditions).length < 2 || !waveHeight || !wavePeriod) return null;

  const seaState = { waveHeight, wavePeriod, waveDir, swellHeight, swellPeriod,
    swellDir, heading, speed, windSpeed_kts };

  const baseShip = { Lwl: ship.Lwl, B: ship.B, rollDamping: ship.rollDamping ?? 0.05,
    fp_from_midship: ship.fp_from_midship ?? (ship.Lwl / 2),
    bridge_from_midship: ship.bridge_from_midship ?? -(ship.Lwl * 0.4) };

  const results = useMemo(() => {
    return Object.entries(conditions).map(([name, cond]) => ({
      name, ...assessCondition(cond, baseShip, seaState),
    }));
  }, [conditions, baseShip, seaState]);

  // Find which condition is more vulnerable (higher cost factor)
  const worst = results.reduce((a, b) => a.costFactor > b.costFactor ? a : b);
  const isSameRisk = results.every(r => r.zone === results[0].zone);

  return (
    <div style={{
      background: "#1E293B", borderRadius: 8, padding: 14,
      border: "1px solid #334155", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ color: "#A78BFA", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>
          MULTI-CONDITION ASSESSMENT
        </div>
        {!isSameRisk && (
          <div style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3,
            background: ZONE_COLORS[worst.zone] + "20",
            color: ZONE_COLORS[worst.zone], fontWeight: 700 }}>
            {worst.name.toUpperCase()} MORE VULNERABLE
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${results.length}, 1fr)`, gap: 10 }}>
        {results.map(r => {
          const zColor = ZONE_COLORS[r.zone] || "#334155";
          const isWorst = r === worst && !isSameRisk;
          return (
            <div key={r.name} style={{
              background: "#0F172A", borderRadius: 6, padding: 10,
              border: `${isWorst ? 2 : 1}px solid ${isWorst ? zColor : "#33415570"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ color: "#E2E8F0", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
                  {r.name}
                </div>
                <div style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3,
                  background: zColor + "25", color: zColor, fontWeight: 700, letterSpacing: "0.05em" }}>
                  {r.zone.toUpperCase()}
                </div>
              </div>

              <div style={{ fontSize: 10, color: "#94A3B8", lineHeight: 1.8 }}>
                <div>GM: <b style={{ color: "#E2E8F0" }}>{r.ship.GM?.toFixed(1)}m</b></div>
                <div>Draught: <b style={{ color: "#E2E8F0" }}>{r.ship.d?.toFixed(1)}m</b></div>
                <div>Tr: <b style={{ color: "#22D3EE" }}>{r.Tr?.toFixed(1)}s</b></div>
                <div>Freeboard: <b style={{ color: "#E2E8F0" }}>{r.ship.bowFreeboard?.toFixed(1)}m</b></div>
              </div>

              <div style={{ borderTop: "1px solid #334155", marginTop: 6, paddingTop: 6,
                fontSize: 10, color: "#94A3B8", lineHeight: 1.8 }}>
                <div>Param ratio: <b style={{ color: zColor }}>
                  {r.paramRatio !== null && isFinite(r.paramRatio) ? r.paramRatio.toFixed(2) : "∞"}
                </b></div>
                <div>Roll: <b style={{ color: r.motions?.roll > 20 ? "#EF4444" : "#E2E8F0" }}>
                  {r.motions?.roll?.toFixed(1) ?? "—"}°
                </b></div>
                <div>Slam: <b style={{ color: r.motions?.slam > 0.1 ? "#EF4444" : "#E2E8F0" }}>
                  {r.motions ? (r.motions.slam * 100).toFixed(0) : "—"}%
                </b></div>
                <div>Cost: <b style={{ color: zColor }}>
                  {isFinite(r.costFactor) ? r.costFactor.toFixed(2) : "∞"}
                </b></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Vulnerability note */}
      {!isSameRisk && (
        <div style={{ marginTop: 8, padding: "6px 8px", background: "#0F172A",
          borderRadius: 4, border: "1px solid #334155", fontSize: 9, color: "#94A3B8", lineHeight: 1.5 }}>
          <b style={{ color: ZONE_COLORS[worst.zone] }}>{worst.name.toUpperCase()}</b> condition
          has {worst.Tr > results.find(r => r !== worst).Tr ? "longer" : "shorter"} natural roll
          period (Tr = {worst.Tr?.toFixed(1)}s) — {worst.ship.GM < results.find(r => r !== worst).ship.GM
            ? "lower GM brings Tr closer to resonance with current sea state"
            : "higher GM in ballast shortens Tr, increasing parametric risk in shorter period waves"}.
          {worst.zone === "dangerous" || worst.zone === "forbidden"
            ? " Consider adjusting ballast to change loading condition."
            : ""}
        </div>
      )}
    </div>
  );
}
