// ─── SpeedHeadingMatrix.jsx — Enhanced speed/heading risk matrix ──────────────
// Phase 2, Item 15
// Highlights: recommended cells (green), danger cells (red), current operating
// point (boxed), and shows a one-line recommendation below the table.
import { useMemo } from "react";
import {
  calcEncounterPeriod, calcParametricRiskRatio, calcMotions,
  calcNaturalRollPeriod, getSafetyCostFactor, getRiskLevel,
} from "../../physics.js";

const HEADINGS = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180];
const SPEEDS = [4, 8, 12, 16, 20, 24];

export default function SpeedHeadingMatrix({
  Tr, wavePeriod, waveHeight, waveDir, heading, speed,
  ship, windSpeed_kts, recommendation,
}) {
  const tw = wavePeriod || 10;

  // Build matrix with cost factors for zone classification
  const matrix = useMemo(() => {
    return SPEEDS.map(s => HEADINGS.map(a => {
      const te = calcEncounterPeriod(tw, s, a);
      const ratio = calcParametricRiskRatio(Tr, te);
      const risk = getRiskLevel(ratio);

      // Compute full motions for cost factor (only if we have wave data)
      let costFactor = 1.0;
      if (waveHeight > 0 && ship?.Lwl) {
        const motions = calcMotions({
          waveHeight_m: waveHeight, wavePeriod_s: tw, waveDir_deg: waveDir ?? a,
          heading_deg: a, speed_kts: s,
          Lwl: ship.Lwl, B: ship.B, GM: ship.GM, Tr,
          rollDamping: ship.rollDamping ?? 0.05,
          bowFreeboard: ship.bowFreeboard ?? 6.0,
          fp_from_midship: ship.fp_from_midship ?? (ship.Lwl / 2),
          bridge_from_midship: ship.bridge_from_midship ?? -(ship.Lwl * 0.4),
        });
        costFactor = motions ? getSafetyCostFactor(motions, waveHeight, windSpeed_kts ?? 0) : 1.0;
      }

      const zone = costFactor <= 1.2 ? "safe"
        : costFactor <= 2.0 ? "marginal"
        : isFinite(costFactor) ? "dangerous" : "forbidden";

      return { heading: a, speed: s, ratio, risk, costFactor, zone };
    }));
  }, [Tr, tw, waveHeight, waveDir, ship, windSpeed_kts]);

  // Find closest heading/speed to current and recommended
  const closestHdg = HEADINGS.reduce((best, h) =>
    Math.abs(h - (heading % 360)) < Math.abs(best - (heading % 360)) ? h : best);
  const closestSpd = SPEEDS.reduce((best, s) =>
    Math.abs(s - speed) < Math.abs(best - speed) ? s : best);
  const recHdg = recommendation?.optimalHeading != null
    ? HEADINGS.reduce((best, h) => Math.abs(h - recommendation.optimalHeading) < Math.abs(best - recommendation.optimalHeading) ? h : best)
    : null;
  const recSpd = recommendation?.optimalSpeed != null
    ? SPEEDS.reduce((best, s) => Math.abs(s - recommendation.optimalSpeed) < Math.abs(best - recommendation.optimalSpeed) ? s : best)
    : null;

  const zoneColors = {
    safe: "#16A34A", marginal: "#F59E0B", dangerous: "#DC2626", forbidden: "#7C3AED",
  };

  // One-line recommendation text
  const recText = recommendation?.severity === "NONE"
    ? "Current heading and speed are within safe limits."
    : recommendation?.bestCell
      ? `Reduce to ${recommendation.optimalSpeed} kts at ${String(recommendation.optimalHeading).padStart(3,"0")}°, or ${
          recommendation.actions?.[0]?.type === "ALTER_COURSE" ? `alter to ${recommendation.actions[0].target}`
          : recommendation.actions?.[0]?.type === "REDUCE_SPEED" ? `reduce to ${recommendation.actions[0].target}`
          : "adjust course and speed"}.`
      : "Monitor conditions closely.";

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace" }}>
          <thead><tr>
            <th style={{ padding: "4px 6px", color: "#F59E0B", borderBottom: "1px solid #334155",
              textAlign: "left" }}>Spd\Hdg</th>
            {HEADINGS.map(a => (
              <th key={a} style={{ padding: "4px 4px", borderBottom: "1px solid #334155",
                textAlign: "center",
                color: a === closestHdg ? "#22D3EE" : "#94A3B8",
                fontWeight: a === closestHdg ? 800 : 400,
              }}>{a}°</th>
            ))}
          </tr></thead>
          <tbody>{matrix.map((row, si) => (
            <tr key={SPEEDS[si]}>
              <td style={{ padding: "4px 6px", fontWeight: 700, borderBottom: "1px solid #1E293B",
                color: SPEEDS[si] === closestSpd ? "#22D3EE" : "#E2E8F0",
              }}>{SPEEDS[si]}kt</td>
              {row.map((cell, hi) => {
                const isCurrent = HEADINGS[hi] === closestHdg && SPEEDS[si] === closestSpd;
                const isRecommended = recHdg !== null && HEADINGS[hi] === recHdg && SPEEDS[si] === recSpd;
                const zoneColor = zoneColors[cell.zone] || "#334155";
                return (
                  <td key={HEADINGS[hi]} style={{
                    padding: "3px 3px", textAlign: "center",
                    background: isRecommended ? "#16A34A30"
                      : isCurrent ? "#22D3EE15"
                      : zoneColor + "15",
                    color: isRecommended ? "#22C55E"
                      : isCurrent ? "#22D3EE"
                      : zoneColor,
                    fontWeight: cell.risk.severity >= 3 || isCurrent || isRecommended ? 800 : 400,
                    borderBottom: "1px solid #1E293B",
                    border: isCurrent ? "2px solid #22D3EE"
                      : isRecommended ? "2px solid #22C55E" : undefined,
                    borderRadius: isCurrent || isRecommended ? 3 : 0,
                    position: "relative",
                  }}>
                    {cell.ratio !== null && isFinite(cell.ratio) ? cell.ratio.toFixed(2) : "∞"}
                    {isCurrent && <div style={{ position: "absolute", top: -1, right: -1,
                      width: 5, height: 5, borderRadius: "50%", background: "#22D3EE" }} />}
                    {isRecommended && !isCurrent && <div style={{ position: "absolute", top: -1, right: -1,
                      width: 5, height: 5, borderRadius: "50%", background: "#22C55E" }} />}
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>

      {/* Recommendation line */}
      <div style={{ marginTop: 8, padding: "6px 8px", background: "#0F172A",
        borderRadius: 4, border: "1px solid #334155", fontSize: 10, lineHeight: 1.5 }}>
        <span style={{ color: "#F59E0B", fontWeight: 700 }}>REC: </span>
        <span style={{ color: "#CBD5E1" }}>{recText}</span>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap", fontSize: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ width: 10, height: 10, border: "2px solid #22D3EE", borderRadius: 2 }} />
          <span style={{ color: "#94A3B8" }}>Current</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ width: 10, height: 10, border: "2px solid #22C55E", borderRadius: 2, background: "#16A34A30" }} />
          <span style={{ color: "#94A3B8" }}>Recommended</span>
        </div>
        {Object.entries(zoneColors).map(([zone, color]) => (
          <div key={zone} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, background: color + "40" }} />
            <span style={{ color: "#94A3B8", textTransform: "capitalize" }}>{zone}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
