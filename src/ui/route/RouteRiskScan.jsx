// ─── RouteRiskScan.jsx — Route-ahead parametric risk timeline ─────────────────
// Phase 2, Item 13
// For each waypoint along the planned route, calculates parametric risk at ETA
// using forecast weather. Shows future risk windows so OOW can plan alterations
// BEFORE entering a danger zone.

import {
  calcNaturalRollPeriod, calcEncounterPeriod,
  calcParametricRiskRatio, calcMotions,
  getSafetyCostFactor, getRiskLevel,
} from "../../physics.js";
import { riskColor, panelBg, SH } from "./shared.jsx";

// ─── Compute risk at a single waypoint given weather + ship params ──────────
function assessWaypoint(weather, heading, speed, ship) {
  if (!weather?.waveHeight || !weather?.wavePeriod) return null;
  const Tr = calcNaturalRollPeriod(ship.B, ship.GM, ship.d, ship.Lwl);
  const relHdg = weather.waveDir != null
    ? ((weather.waveDir - heading + 360) % 360) : 0;
  const Te = calcEncounterPeriod(weather.wavePeriod, speed, relHdg);
  const paramRatio = calcParametricRiskRatio(Tr, Te);

  const motions = calcMotions({
    waveHeight_m: weather.waveHeight ?? 0,
    wavePeriod_s: weather.wavePeriod ?? 8,
    waveDir_deg: weather.waveDir ?? heading,
    swellHeight_m: weather.swellHeight ?? 0,
    swellPeriod_s: weather.swellPeriod ?? 10,
    swellDir_deg: weather.swellDir ?? heading,
    heading_deg: heading, speed_kts: speed,
    Lwl: ship.Lwl, B: ship.B, GM: ship.GM, Tr,
    rollDamping: ship.rollDamping ?? 0.05,
    bowFreeboard: ship.bowFreeboard ?? 6.0,
    fp_from_midship: ship.fp_from_midship ?? (ship.Lwl / 2),
    bridge_from_midship: ship.bridge_from_midship ?? -(ship.Lwl * 0.4),
  });

  const windKts = weather.windKts ?? (weather.windSpeed ? weather.windSpeed / 1.852 : 0);
  const costFactor = motions ? getSafetyCostFactor(motions, weather.waveHeight, windKts) : 1.0;
  const risk = getRiskLevel(paramRatio);

  return {
    paramRatio, costFactor, risk,
    roll: motions?.roll ?? 0,
    pitch: motions?.pitch ?? 0,
    slam: motions?.slam ?? 0,
    paramRisk: motions?.paramRisk ?? 0,
    waveHeight: weather.waveHeight,
    wavePeriod: weather.wavePeriod,
  };
}

// ─── Format ETA as HH:MM or "Day N HH:MM" ──────────────────────────────────
function fmtETA(ms) {
  const d = new Date(ms);
  const now = new Date();
  const dayDiff = Math.floor((ms - now.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return dayDiff > 0 ? `D+${dayDiff} ${time}` : time;
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function RouteRiskScan({
  voyageWeather, voyageWPs, shipParams, voyageSpeed,
}) {
  if (!voyageWeather?.length || !voyageWPs?.length || !shipParams) return null;

  // Compute heading per leg
  const wpHeadings = [];
  for (let i = 0; i < voyageWPs.length; i++) {
    if (i < voyageWPs.length - 1) {
      const wp = voyageWPs[i], next = voyageWPs[i + 1];
      const dLon = (next.lon - wp.lon) * Math.PI / 180;
      const la1 = wp.lat * Math.PI / 180, la2 = next.lat * Math.PI / 180;
      wpHeadings.push(((Math.atan2(
        Math.sin(dLon) * Math.cos(la2),
        Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)
      ) * 180 / Math.PI) + 360) % 360);
    } else {
      wpHeadings.push(wpHeadings.length > 0 ? wpHeadings[wpHeadings.length - 1] : 0);
    }
  }

  // Build the ship config object
  const ship = {
    Lwl: shipParams.Lwl, B: shipParams.B, GM: shipParams.GM,
    d: shipParams.d ?? 12, rollDamping: shipParams.rollDamping ?? 0.05,
    bowFreeboard: shipParams.bowFreeboard ?? 6.0,
    fp_from_midship: shipParams.fp_from_midship ?? (shipParams.Lwl / 2),
    bridge_from_midship: shipParams.bridge_from_midship ?? -(shipParams.Lwl * 0.4),
  };

  // Assess risk at each sample point along the voyage
  const speed = voyageSpeed || shipParams.speed || 15;
  const scanPoints = voyageWeather.map((pt, i) => {
    // Find closest waypoint heading for this sample point
    let heading = shipParams.heading || 0;
    if (voyageWPs.length > 1 && pt.etaMs) {
      const wpIdx = voyageWPs.findIndex(wp => wp.etaMs >= pt.etaMs);
      const idx = wpIdx > 0 ? wpIdx - 1 : Math.max(0, wpIdx);
      heading = wpHeadings[Math.min(idx, wpHeadings.length - 1)] ?? heading;
    }

    const weather = pt.weather || pt;
    const assessment = assessWaypoint(weather, heading, speed, ship);
    return {
      ...pt,
      heading,
      assessment,
      riskSeverity: assessment?.risk?.severity ?? 0,
      zone: !assessment ? "unknown"
        : assessment.costFactor <= 1.2 ? "safe"
        : assessment.costFactor <= 2.0 ? "marginal"
        : isFinite(assessment.costFactor) ? "dangerous" : "forbidden",
    };
  });

  // Find danger windows (contiguous non-safe zones)
  const dangerWindows = [];
  let winStart = null;
  for (let i = 0; i < scanPoints.length; i++) {
    const pt = scanPoints[i];
    if (pt.zone !== "safe" && pt.zone !== "unknown") {
      if (!winStart) winStart = { idx: i, etaMs: pt.etaMs };
    } else if (winStart) {
      dangerWindows.push({ ...winStart, endIdx: i - 1, endEtaMs: scanPoints[i - 1].etaMs });
      winStart = null;
    }
  }
  if (winStart) dangerWindows.push({
    ...winStart, endIdx: scanPoints.length - 1,
    endEtaMs: scanPoints[scanPoints.length - 1].etaMs,
  });

  const maxRoll = Math.max(...scanPoints.map(p => p.assessment?.roll ?? 0), 1);
  const totalPts = scanPoints.length || 1;
  const zoneColors = { safe: "#16A34A", marginal: "#F59E0B", dangerous: "#DC2626", forbidden: "#7C3AED", unknown: "#334155" };

  return (
    <div style={{ background: panelBg, borderRadius: 8, padding: "12px 16px",
      border: "1px solid #334155", marginBottom: 12 }}>
      {SH("Route-Ahead Risk Scan")}

      {/* Danger windows summary */}
      {dangerWindows.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "#F59E0B", fontSize: 10, fontWeight: 700, marginBottom: 4,
            letterSpacing: "0.1em" }}>
            {dangerWindows.length} RISK WINDOW{dangerWindows.length > 1 ? "S" : ""} AHEAD
          </div>
          {dangerWindows.map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8,
              padding: "4px 8px", marginBottom: 2, background: "#0F172A",
              borderRadius: 3, border: "1px solid #33415570", fontSize: 9 }}>
              <span style={{ color: zoneColors[scanPoints[w.idx].zone] || "#F59E0B",
                fontWeight: 800 }}>
                {scanPoints[w.idx].zone?.toUpperCase()}
              </span>
              <span style={{ color: "#94A3B8" }}>
                ETA {fmtETA(w.etaMs)} → {fmtETA(w.endEtaMs)}
              </span>
              <span style={{ color: "#64748B" }}>
                Hs {scanPoints[w.idx].assessment?.waveHeight?.toFixed(1) ?? "?"}m
                | Roll {scanPoints[w.idx].assessment?.roll?.toFixed(0) ?? "?"}°
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#22C55E", fontSize: 10, fontWeight: 700, marginBottom: 8 }}>
          ✓ NO RISK WINDOWS DETECTED ON PLANNED ROUTE
        </div>
      )}

      {/* Visual risk timeline — colored bars per sample point */}
      <div style={{ display: "flex", gap: 1, alignItems: "flex-end", height: 56 }}>
        {scanPoints.map((pt, i) => {
          const rollPct = Math.min((pt.assessment?.roll ?? 0) / maxRoll, 1);
          const color = zoneColors[pt.zone] || "#334155";
          return (
            <div key={i} title={
              `${pt.lat?.toFixed(1)},${pt.lon?.toFixed(1)} ETA:${pt.etaMs ? fmtETA(pt.etaMs) : "?"}\n` +
              `Hs:${pt.assessment?.waveHeight?.toFixed(1) ?? "?"}m Tw:${pt.assessment?.wavePeriod?.toFixed(0) ?? "?"}s\n` +
              `Roll:${pt.assessment?.roll?.toFixed(1) ?? "?"}° Hdg:${pt.heading?.toFixed(0) ?? "?"}°`
            } style={{
              flex: 1, minWidth: 2, maxWidth: 8,
              height: `${Math.max(rollPct * 100, 8)}%`,
              background: color + "80",
              borderTop: `2px solid ${color}`,
              borderRadius: "2px 2px 0 0",
              transition: "height 0.3s",
            }} />
          );
        })}
      </div>

      {/* ETA labels along the bottom */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: "#64748B" }}>
        {scanPoints.length > 0 && <span>{scanPoints[0].etaMs ? fmtETA(scanPoints[0].etaMs) : "BOSP"}</span>}
        {scanPoints.length > 2 && <span>{fmtETA(scanPoints[Math.floor(scanPoints.length / 2)].etaMs)}</span>}
        {scanPoints.length > 0 && <span>{scanPoints[scanPoints.length - 1].etaMs ? fmtETA(scanPoints[scanPoints.length - 1].etaMs) : "EOSP"}</span>}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        {Object.entries(zoneColors).filter(([k]) => k !== "unknown").map(([zone, color]) => (
          <div key={zone} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, background: color }} />
            <span style={{ color: "#94A3B8", textTransform: "capitalize" }}>{zone}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
