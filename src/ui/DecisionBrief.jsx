// ─── DecisionBrief.jsx — Actionable recommendation panel ─────────────────────
// Phase 2, Item 12
// Full-width panel shown when risk >= ELEVATED. Contains:
//   1. Plain English summary
//   2. Current vs recommended comparison
//   3. Risk-reduction estimate
//   4. IMO MSC.1/Circ.1228 action categories
import { useMemo } from "react";
import { generateRecommendation } from "../core/riskEngine.js";
import { Panel, sectionHeader } from "./components/styles.jsx";

const ACTION_ICONS = {
  ALTER_COURSE: "🧭",
  REDUCE_SPEED: "⚓",
  ALTER_COURSE_AND_SPEED: "🔄",
  ADJUST_BALLAST: "⚖",
  ACTIVATE_STABILISERS: "🛡",
};

const ACTION_LABELS = {
  ALTER_COURSE: "Alter Course",
  REDUCE_SPEED: "Reduce Speed",
  ALTER_COURSE_AND_SPEED: "Alter Course & Speed",
  ADJUST_BALLAST: "Adjust Ballast",
  ACTIVATE_STABILISERS: "Activate Stabilisers",
};

const SEVERITY_STYLES = {
  NONE:     { bg: "#16A34A15", border: "#16A34A", color: "#22C55E", badge: "SAFE" },
  MODERATE: { bg: "#3B82F615", border: "#3B82F6", color: "#60A5FA", badge: "MODERATE" },
  ELEVATED: { bg: "#F59E0B15", border: "#F59E0B", color: "#FBBF24", badge: "ELEVATED" },
  HIGH:     { bg: "#DC262615", border: "#DC2626", color: "#F87171", badge: "HIGH" },
  CRITICAL: { bg: "#7C3AED15", border: "#7C3AED", color: "#A78BFA", badge: "CRITICAL" },
};

export default function DecisionBrief({
  waveHeight_m, wavePeriod_s, waveDir_deg,
  swellHeight_m, swellPeriod_s, swellDir_deg,
  windSpeed_kts, ship, currentHeading, currentSpeed,
}) {
  const rec = useMemo(() => {
    if (!waveHeight_m || !wavePeriod_s || !ship?.Lwl) return null;
    return generateRecommendation({
      waveHeight_m, wavePeriod_s, waveDir_deg,
      swellHeight_m, swellPeriod_s, swellDir_deg,
      Lwl: ship.Lwl, B: ship.B, GM: ship.GM, d: ship.d,
      rollDamping: ship.rollDamping ?? 0.05,
      bowFreeboard: ship.bowFreeboard ?? 6.0,
      fp_from_midship: ship.fp_from_midship ?? (ship.Lwl / 2),
      bridge_from_midship: ship.bridge_from_midship ?? -(ship.Lwl * 0.4),
      windSpeed_kts: windSpeed_kts ?? 0,
      currentHeading, currentSpeed,
    });
  }, [waveHeight_m, wavePeriod_s, waveDir_deg, swellHeight_m, swellPeriod_s,
      swellDir_deg, windSpeed_kts, ship, currentHeading, currentSpeed]);

  if (!rec || rec.severity === "NONE") return null;

  const sev = SEVERITY_STYLES[rec.severity] || SEVERITY_STYLES.MODERATE;
  const pulsing = rec.severity === "HIGH" || rec.severity === "CRITICAL";

  return (
    <div style={{
      background: sev.bg, border: `2px solid ${sev.border}`,
      borderRadius: 8, padding: 16, marginBottom: 16,
      fontFamily: "'JetBrains Mono', monospace",
      animation: pulsing ? "pulse 2s infinite" : "none",
    }}>
      {/* ── Header with severity badge ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            background: sev.border, color: "#0F172A", padding: "4px 12px",
            borderRadius: 4, fontSize: 11, fontWeight: 800, letterSpacing: "0.15em",
          }}>
            ⚠ {sev.badge} RISK
          </div>
          <span style={{ color: "#94A3B8", fontSize: 10 }}>
            IMO MSC.1/Circ.1228 Assessment
          </span>
        </div>
        <div style={{ fontSize: 9, color: "#64748B" }}>
          Tr = {rec.Tr?.toFixed(1)}s
        </div>
      </div>

      {/* ── Plain English summary ── */}
      <div style={{
        color: sev.color, fontSize: 13, fontWeight: 700,
        lineHeight: 1.6, marginBottom: 14,
      }}>
        {rec.summary}
      </div>

      {/* ── Current vs Recommended comparison ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 12, marginBottom: 14,
      }}>
        <div style={{
          background: "#0F172A", borderRadius: 6, padding: 10,
          border: `1px solid ${rec.currentCell?.zone === "safe" ? "#16A34A50" : "#DC262650"}`,
        }}>
          <div style={{ color: "#64748B", fontSize: 9, fontWeight: 700, marginBottom: 6, letterSpacing: "0.1em" }}>
            CURRENT
          </div>
          <div style={{ color: "#E2E8F0", fontSize: 14, fontWeight: 800 }}>
            {String(currentHeading).padStart(3, "0")}° at {currentSpeed} kts
          </div>
          <div style={{ color: "#94A3B8", fontSize: 10, marginTop: 4 }}>
            Cost factor: <span style={{ color: sev.color, fontWeight: 700 }}>
              {isFinite(rec.currentRisk) ? rec.currentRisk.toFixed(2) : "∞"}
            </span>
          </div>
          {rec.currentCell && (
            <div style={{ color: "#64748B", fontSize: 9, marginTop: 2 }}>
              Roll: {rec.currentCell.roll?.toFixed(1)}° | Slam: {(rec.currentCell.slam * 100).toFixed(0)}%
            </div>
          )}
        </div>

        {rec.bestCell && (
          <div style={{
            background: "#0F172A", borderRadius: 6, padding: 10,
            border: "1px solid #16A34A50",
          }}>
            <div style={{ color: "#16A34A", fontSize: 9, fontWeight: 700, marginBottom: 6, letterSpacing: "0.1em" }}>
              RECOMMENDED
            </div>
            <div style={{ color: "#E2E8F0", fontSize: 14, fontWeight: 800 }}>
              {String(rec.optimalHeading).padStart(3, "0")}° at {rec.optimalSpeed} kts
            </div>
            <div style={{ color: "#94A3B8", fontSize: 10, marginTop: 4 }}>
              Cost factor: <span style={{ color: "#22C55E", fontWeight: 700 }}>
                {isFinite(rec.recommendedRisk) ? rec.recommendedRisk.toFixed(2) : "—"}
              </span>
            </div>
            <div style={{ color: "#64748B", fontSize: 9, marginTop: 2 }}>
              Roll: {rec.bestCell.roll?.toFixed(1)}° | Slam: {(rec.bestCell.slam * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>

      {/* ── Action recommendations ── */}
      {rec.actions.length > 0 && (
        <div>
          <div style={{ color: "#F59E0B", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>
            RECOMMENDED ACTIONS
          </div>
          {rec.actions.map((action, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "8px 10px", marginBottom: 4,
              background: "#0F172A", borderRadius: 4, border: "1px solid #334155",
            }}>
              <span style={{ fontSize: 16, minWidth: 24 }}>
                {ACTION_ICONS[action.type] || "▸"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#E2E8F0", fontSize: 11, fontWeight: 700 }}>
                  {ACTION_LABELS[action.type] || action.type}
                </div>
                <div style={{ color: "#94A3B8", fontSize: 10 }}>
                  {action.target}
                </div>
                <div style={{ color: "#22C55E", fontSize: 9, marginTop: 2 }}>
                  {action.reduction}
                </div>
              </div>
              <span style={{
                color: "#475569", fontSize: 9, fontWeight: 700,
                background: "#1E293B", padding: "2px 6px", borderRadius: 3,
              }}>
                P{action.priority}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Safe / Avoid corridors ── */}
      <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        {rec.safeCorridors?.length > 0 && (
          <div style={{ fontSize: 9, color: "#22C55E" }}>
            <span style={{ fontWeight: 700, letterSpacing: "0.1em" }}>SAFE: </span>
            {rec.safeCorridors.map((c, i) => (
              <span key={i} style={{ background: "#16A34A20", padding: "2px 6px", borderRadius: 3, marginRight: 4 }}>
                {String(c.from).padStart(3, "0")}°–{String(c.to).padStart(3, "0")}°
              </span>
            ))}
          </div>
        )}
        {rec.avoidCorridors?.length > 0 && (
          <div style={{ fontSize: 9, color: "#EF4444" }}>
            <span style={{ fontWeight: 700, letterSpacing: "0.1em" }}>AVOID: </span>
            {rec.avoidCorridors.map((c, i) => (
              <span key={i} style={{ background: "#DC262620", padding: "2px 6px", borderRadius: 3, marginRight: 4 }}>
                {String(c.from).padStart(3, "0")}°–{String(c.to).padStart(3, "0")}°
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
