// ─── physics.js ───────────────────────────────────────────────────────────────
// Shared physics engine for parametric rolling assessment
// IMO MSC.1/Circ.1228 compliant calculations
// Single source of truth — imported by App.jsx, RouteChart.jsx, MeteoOverlay.jsx

export const G = 9.81;
export const KTS_TO_MS = 0.51444;
export const DEG_TO_RAD = Math.PI / 180;

export function calcNaturalRollPeriod(B, GM, d, Lwl, method = "imo") {
  if (GM <= 0 || B <= 0) return Infinity;
  if (method === "imo") {
    const C = 0.373 + 0.023 * (B / d) - 0.043 * (Lwl / 100);
    return 2 * C * B / Math.sqrt(GM);
  }
  const k = 0.39 * B;
  return (2 * Math.PI * k) / Math.sqrt(G * GM);
}

export function calcWaveLength(Tw) {
  return (G * Tw * Tw) / (2 * Math.PI);
}

export function calcEncounterPeriod(Tw, V_kts, headingRel) {
  if (Tw <= 0) return Tw;
  const V = V_kts * KTS_TO_MS;
  const alpha = headingRel * DEG_TO_RAD;
  const waveSpeed = (G * Tw) / (2 * Math.PI);
  const denom = 1 - (V * Math.cos(alpha)) / waveSpeed;
  if (Math.abs(denom) < 0.01) return Infinity;
  return Tw / Math.abs(denom);
}

export function calcParametricRiskRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / (2 * Te);
}

export function calcSynchronousRiskRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / Te;
}

/**
 * Full risk assessment — returns { level, color, severity }
 * Used by App.jsx dashboard gauges and timeline
 */
export function getRiskLevel(ratio) {
  if (ratio === null) return { level: "UNKNOWN", color: "#6B7280", severity: 0 };
  const dev = Math.abs(ratio - 1.0);
  if (dev <= 0.1) return { level: "CRITICAL", color: "#DC2626", severity: 5 };
  if (dev <= 0.2) return { level: "HIGH", color: "#EA580C", severity: 4 };
  if (dev <= 0.3) return { level: "ELEVATED", color: "#D97706", severity: 3 };
  if (dev <= 0.4) return { level: "MODERATE", color: "#CA8A04", severity: 2 };
  if (dev <= 0.5) return { level: "LOW", color: "#16A34A", severity: 1 };
  return { level: "MINIMAL", color: "#0D9488", severity: 0 };
}

/**
 * Numeric severity only (0-5) — used by RouteChart risk circles
 */
export function getRiskSeverity(ratio) {
  return getRiskLevel(ratio).severity;
}

/**
 * Label string from severity number — used by RouteChart popups
 */
export function getRiskLabel(severity) {
  return ["MINIMAL","LOW","MODERATE","ELEVATED","HIGH","CRITICAL"][severity] || "UNKNOWN";
}

/**
 * Risk intensity (0-1) for meteo overlay gradient
 * Returns how close the parametric ratio is to 1.0 (danger zone)
 */
export function calcRiskIntensity(Tw, waveDir, shipTr, shipSpeed, shipHeading) {
  if (!Tw || !shipTr || shipTr <= 0) return 0;
  const V = (shipSpeed || 15) * KTS_TO_MS;
  const rel = waveDir != null ? ((waveDir - (shipHeading || 0) + 360) % 360) : 0;
  const waveSpd = (G * Tw) / (2 * Math.PI);
  const den = 1 - (V * Math.cos(rel * DEG_TO_RAD)) / waveSpd;
  if (Math.abs(den) < 0.01) return 0;
  const Te = Tw / Math.abs(den);
  const ratio = shipTr / (2 * Te);
  return Math.max(0, 1 - Math.abs(ratio - 1));
}
