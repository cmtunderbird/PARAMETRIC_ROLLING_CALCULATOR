// ─── ensembleSpread.js — Uncertainty computation from ensemble members ───────
// Phase 3, Item 24
// When available (GFS ensemble, CMEMS ensemble), computes spread as uncertainty
// bands. A narrow spread = high confidence; wide spread = uncertain forecast.
// Currently a framework — populated when ensemble providers are connected.

/**
 * Compute ensemble statistics from multiple forecast members.
 * @param {Array<{waveHeight: number[], wavePeriod: number[]}>} members — array of forecast members
 * @returns {{ mean: number[], p10: number[], p90: number[], spread: number[] }}
 */
export function computeEnsembleSpread(members, field = "waveHeight") {
  if (!members?.length) return null;
  const nSteps = members[0][field]?.length ?? 0;
  if (nSteps === 0) return null;

  const mean = [], p10 = [], p90 = [], spread = [];

  for (let t = 0; t < nSteps; t++) {
    const vals = members.map(m => m[field]?.[t]).filter(v => v != null && isFinite(v));
    if (vals.length === 0) { mean.push(null); p10.push(null); p90.push(null); spread.push(null); continue; }
    vals.sort((a, b) => a - b);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const i10 = Math.floor(vals.length * 0.1);
    const i90 = Math.min(Math.floor(vals.length * 0.9), vals.length - 1);
    mean.push(Math.round(avg * 100) / 100);
    p10.push(vals[i10]);
    p90.push(vals[i90]);
    spread.push(Math.round((vals[i90] - vals[i10]) * 100) / 100);
  }
  return { mean, p10, p90, spread };
}

/**
 * Classify uncertainty level from ensemble spread.
 * @param {number} spreadValue — p90 - p10 at a given time step
 * @param {number} meanValue — ensemble mean at that step
 * @returns {{ level: string, color: string, confidence: number }}
 */
export function classifyUncertainty(spreadValue, meanValue) {
  if (spreadValue == null || meanValue == null || meanValue <= 0)
    return { level: "UNKNOWN", color: "#64748B", confidence: 0 };
  const relSpread = spreadValue / meanValue;  // relative spread
  if (relSpread < 0.15) return { level: "HIGH", color: "#22C55E", confidence: 5 };
  if (relSpread < 0.3)  return { level: "GOOD", color: "#3B82F6", confidence: 4 };
  if (relSpread < 0.5)  return { level: "MODERATE", color: "#F59E0B", confidence: 3 };
  if (relSpread < 0.8)  return { level: "LOW", color: "#EF4444", confidence: 2 };
  return { level: "VERY LOW", color: "#7C3AED", confidence: 1 };
}

/**
 * Check if ensemble data is available for a given provider result.
 * Currently always returns false — will return true when GFS ensemble
 * or CMEMS ensemble providers are connected.
 */
export function hasEnsembleData(/* providerResult */) {
  return false;
}
