// ─── riskEngine.js — Decision engine for speed/heading recommendations ───────
// Phase 2, Item 11
// Sweeps heading 0-359° and speed 4-24 kts, builds a risk matrix,
// identifies safe zones, and generates IMO MSC.1/Circ.1228 action recommendations.
// Calls physics.js exclusively — never reimplements physics logic.

import {
  calcNaturalRollPeriod, calcEncounterPeriod, calcWaveLength,
  calcParametricRiskRatio, calcSynchronousRiskRatio,
  calcMotions, getSafetyCostFactor, getRiskLevel,
} from "../physics.js";

// ─── Configuration ──────────────────────────────────────────────────────────
const HEADING_STEP = 5;      // degrees
const SPEED_MIN = 4;
const SPEED_MAX = 24;
const SPEED_STEP = 1;        // knots
const HEADINGS = Array.from({ length: 360 / HEADING_STEP }, (_, i) => i * HEADING_STEP);
const SPEEDS = Array.from({ length: (SPEED_MAX - SPEED_MIN) / SPEED_STEP + 1 },
  (_, i) => SPEED_MIN + i * SPEED_STEP);

// Cost factor thresholds (from physics.js SafetyLimits methodology)
const SAFE_THRESHOLD = 1.2;
const MARGINAL_THRESHOLD = 2.0;

// ─── Build the full risk matrix ─────────────────────────────────────────────
// Returns a 2D array [headingIdx][speedIdx] with cost factor + motions at each point
export function buildRiskMatrix({
  waveHeight_m, wavePeriod_s, waveDir_deg,
  swellHeight_m = 0, swellPeriod_s = 0, swellDir_deg = 0,
  Lwl, B, GM, d, rollDamping = 0.05,
  bowFreeboard = 6.0, fp_from_midship = 88.0, bridge_from_midship = -70.0,
  windSpeed_kts = 0,
}) {
  const Tr = calcNaturalRollPeriod(B, GM, d, Lwl);
  const matrix = [];

  for (const heading of HEADINGS) {
    const row = [];
    for (const speed of SPEEDS) {
      const motions = calcMotions({
        waveHeight_m, wavePeriod_s, waveDir_deg,
        swellHeight_m, swellPeriod_s, swellDir_deg,
        heading_deg: heading, speed_kts: speed,
        Lwl, B, GM, Tr, rollDamping,
        bowFreeboard, fp_from_midship, bridge_from_midship,
      });
      const costFactor = motions
        ? getSafetyCostFactor(motions, waveHeight_m, windSpeed_kts)
        : 1.0;

      // Parametric risk ratio for quick reference
      const relHeading = waveDir_deg != null
        ? ((waveDir_deg - heading + 360) % 360) : 0;
      const Te = calcEncounterPeriod(wavePeriod_s, speed, relHeading);
      const paramRatio = calcParametricRiskRatio(Tr, Te);

      row.push({
        heading, speed, costFactor, paramRatio,
        roll: motions?.roll ?? 0,
        pitch: motions?.pitch ?? 0,
        slam: motions?.slam ?? 0,
        paramRisk: motions?.paramRisk ?? 0,
        zone: costFactor <= SAFE_THRESHOLD ? "safe"
            : costFactor <= MARGINAL_THRESHOLD ? "marginal"
            : isFinite(costFactor) ? "dangerous" : "forbidden",
      });
    }
    matrix.push(row);
  }
  return { matrix, headings: HEADINGS, speeds: SPEEDS, Tr };
}

// ─── Find safe heading corridors ────────────────────────────────────────────
// Returns array of { from, to } degree ranges where the vessel is safe at any reasonable speed
function findSafeCorridors(matrix, speeds) {
  const midSpeedIdx = Math.floor(speeds.length / 2); // test at mid-range speed
  const safeHeadings = [];

  for (let hi = 0; hi < matrix.length; hi++) {
    // A heading is "safe" if at least one speed in 8-20kt range is safe
    const hasSafe = matrix[hi].some((cell, si) =>
      speeds[si] >= 8 && speeds[si] <= 20 && cell.zone === "safe");
    safeHeadings.push(hasSafe);
  }

  // Merge consecutive safe headings into corridors
  const corridors = [];
  let start = null;
  for (let i = 0; i <= safeHeadings.length; i++) {
    if (i < safeHeadings.length && safeHeadings[i]) {
      if (start === null) start = i;
    } else if (start !== null) {
      corridors.push({
        from: start * HEADING_STEP,
        to: (i - 1) * HEADING_STEP,
      });
      start = null;
    }
  }
  // Handle wrap-around (e.g., safe from 350° through 010°)
  if (corridors.length >= 2 &&
      corridors[0].from === 0 &&
      corridors[corridors.length - 1].to === (HEADINGS.length - 1) * HEADING_STEP) {
    const last = corridors.pop();
    corridors[0].from = last.from;
  }
  return corridors;
}

// ─── Find avoid corridors (dangerous/forbidden zones) ───────────────────────
function findAvoidCorridors(matrix, speeds) {
  const dangerHeadings = [];
  for (let hi = 0; hi < matrix.length; hi++) {
    // A heading is "avoid" if ALL speeds produce dangerous/forbidden
    const allDangerous = matrix[hi].every(cell =>
      cell.zone === "dangerous" || cell.zone === "forbidden");
    dangerHeadings.push(allDangerous);
  }

  const corridors = [];
  let start = null;
  for (let i = 0; i <= dangerHeadings.length; i++) {
    if (i < dangerHeadings.length && dangerHeadings[i]) {
      if (start === null) start = i;
    } else if (start !== null) {
      corridors.push({ from: start * HEADING_STEP, to: (i - 1) * HEADING_STEP });
      start = null;
    }
  }
  return corridors;
}

// ─── Angular distance (handles wrap-around) ─────────────────────────────────
function angularDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ─── Main recommendation engine ─────────────────────────────────────────────
// For the current sea state, vessel config, and operating point,
// sweeps all heading/speed combinations to find the safest options.
export function generateRecommendation({
  waveHeight_m, wavePeriod_s, waveDir_deg,
  swellHeight_m = 0, swellPeriod_s = 0, swellDir_deg = 0,
  Lwl, B, GM, d, rollDamping = 0.05,
  bowFreeboard = 6.0, fp_from_midship = 88.0, bridge_from_midship = -70.0,
  windSpeed_kts = 0,
  currentHeading, currentSpeed,
}) {
  // Build the full risk matrix
  const { matrix, headings, speeds, Tr } = buildRiskMatrix({
    waveHeight_m, wavePeriod_s, waveDir_deg,
    swellHeight_m, swellPeriod_s, swellDir_deg,
    Lwl, B, GM, d, rollDamping,
    bowFreeboard, fp_from_midship, bridge_from_midship,
    windSpeed_kts,
  });

  // ── Assess current operating point ──
  const curHdgIdx = Math.round((currentHeading % 360) / HEADING_STEP) % headings.length;
  const curSpdIdx = Math.max(0, Math.min(speeds.length - 1,
    Math.round((currentSpeed - SPEED_MIN) / SPEED_STEP)));
  const currentCell = matrix[curHdgIdx][curSpdIdx];
  const currentRisk = currentCell.costFactor;

  // ── If current point is safe, no action needed ──
  if (currentCell.zone === "safe") {
    return {
      severity: "NONE",
      summary: "Current heading and speed are within safe operating limits.",
      actions: [],
      safeCorridors: findSafeCorridors(matrix, speeds),
      avoidCorridors: findAvoidCorridors(matrix, speeds),
      optimalHeading: currentHeading,
      optimalSpeed: currentSpeed,
      currentRisk,
      recommendedRisk: currentRisk,
      matrix, headings, speeds, Tr,
    };
  }

  // ── Find optimal safe operating point ──
  // Priority: minimise course deviation while keeping risk acceptable
  // Secondary: prefer higher speed (closer to current) when multiple options
  let bestCell = null;
  let bestScore = Infinity;

  for (let hi = 0; hi < matrix.length; hi++) {
    for (let si = 0; si < matrix[hi].length; si++) {
      const cell = matrix[hi][si];
      if (cell.zone !== "safe") continue;

      // Score: heading deviation (weighted heavily) + speed deviation
      const hdgDev = angularDist(cell.heading, currentHeading);
      const spdDev = Math.abs(cell.speed - currentSpeed);
      const score = hdgDev * 2 + spdDev; // heading changes cost 2x speed changes

      if (score < bestScore) {
        bestScore = score;
        bestCell = cell;
      }
    }
  }

  // If no safe point found, look for best marginal point
  if (!bestCell) {
    for (let hi = 0; hi < matrix.length; hi++) {
      for (let si = 0; si < matrix[hi].length; si++) {
        const cell = matrix[hi][si];
        if (cell.zone !== "marginal") continue;
        const hdgDev = angularDist(cell.heading, currentHeading);
        const spdDev = Math.abs(cell.speed - currentSpeed);
        const score = hdgDev * 2 + spdDev;
        if (score < bestScore) { bestScore = score; bestCell = cell; }
      }
    }
  }

  // ── Find best speed at current heading (speed-only fix) ──
  let bestSpeedAtCurrent = null;
  let bestSpeedCost = Infinity;
  for (let si = 0; si < speeds.length; si++) {
    const cell = matrix[curHdgIdx][si];
    if (cell.costFactor < bestSpeedCost) {
      bestSpeedCost = cell.costFactor;
      bestSpeedAtCurrent = cell;
    }
  }

  // ── Determine severity ──
  const severity = currentCell.zone === "forbidden" ? "CRITICAL"
    : currentCell.zone === "dangerous" ? "HIGH"
    : currentCell.zone === "marginal" ? "ELEVATED"
    : "MODERATE";

  // ── Build corridors ──
  const safeCorridors = findSafeCorridors(matrix, speeds);
  const avoidCorridors = findAvoidCorridors(matrix, speeds);

  // ── Generate action recommendations (IMO MSC.1/Circ.1228 categories) ──
  const actions = [];

  // Action 1: Alter course (if optimal heading differs)
  if (bestCell && angularDist(bestCell.heading, currentHeading) >= 10) {
    const nearestCorridor = safeCorridors.length > 0
      ? safeCorridors.reduce((best, c) => {
          const midC = ((c.from + c.to) / 2 + 360) % 360;
          return angularDist(midC, currentHeading) < angularDist(
            ((best.from + best.to) / 2 + 360) % 360, currentHeading) ? c : best;
        })
      : null;
    const target = nearestCorridor
      ? `${String(nearestCorridor.from).padStart(3, "0")}°–${String(nearestCorridor.to).padStart(3, "0")}°`
      : `${String(bestCell.heading).padStart(3, "0")}°`;
    const riskZone = bestCell.zone === "safe" ? "LOW" : "MODERATE";
    actions.push({
      type: "ALTER_COURSE",
      target,
      reduction: `Risk drops to ${riskZone}`,
      priority: 1,
    });
  }

  // Action 2: Reduce speed (if speed change at current heading helps)
  if (bestSpeedAtCurrent && bestSpeedAtCurrent.speed < currentSpeed &&
      bestSpeedAtCurrent.costFactor < currentRisk * 0.7) {
    const riskZone = bestSpeedAtCurrent.zone === "safe" ? "LOW"
      : bestSpeedAtCurrent.zone === "marginal" ? "MODERATE" : "HIGH";
    actions.push({
      type: "REDUCE_SPEED",
      target: `${bestSpeedAtCurrent.speed} kts`,
      reduction: `Risk drops to ${riskZone}`,
      priority: 2,
    });
  }

  // Action 3: Combined course + speed (if neither alone is sufficient)
  if (bestCell && actions.length === 0) {
    actions.push({
      type: "ALTER_COURSE_AND_SPEED",
      target: `${String(bestCell.heading).padStart(3, "0")}° at ${bestCell.speed} kts`,
      reduction: `Risk drops to ${bestCell.zone === "safe" ? "LOW" : "MODERATE"}`,
      priority: 1,
    });
  }

  // Action 4: Adjust ballast (always relevant for parametric rolling)
  if (severity === "HIGH" || severity === "CRITICAL") {
    actions.push({
      type: "ADJUST_BALLAST",
      target: "Modify GM to change natural roll period",
      reduction: "Shifts resonance away from current encounter period",
      priority: 3,
    });
  }

  // Action 5: Activate stabilisers (if vessel equipped)
  if (currentCell.roll > 15) {
    actions.push({
      type: "ACTIVATE_STABILISERS",
      target: "Engage fin stabilisers or anti-roll tanks",
      reduction: "Reduces roll amplitude directly",
      priority: 4,
    });
  }

  // ── Generate plain English summary ──
  const riskName = getRiskLevel(currentCell.paramRatio)?.level || severity;
  let summary;
  if (severity === "CRITICAL") {
    summary = `FORBIDDEN conditions detected. ${
      currentCell.roll > 30 ? `Roll amplitude ${(currentCell.roll||0).toFixed(0)}° exceeds safe limits.`
      : "Immediate course and/or speed change required."
    }`;
  } else if (severity === "HIGH") {
    summary = `Parametric rolling risk is HIGH on current heading.${
      bestCell ? ` Recommend altering to ${String(bestCell.heading).padStart(3, "0")}°` +
        (bestCell.speed !== currentSpeed ? ` at ${bestCell.speed} kts.` : ".")
      : " Reduce speed and consider course alteration."
    }`;
  } else {
    summary = `Risk level ${riskName} on current heading.${
      bestCell ? ` Safe corridor available at ${String(bestCell.heading).padStart(3, "0")}°.`
      : " Monitor conditions closely."
    }`;
  }

  return {
    severity,
    summary,
    actions: actions.sort((a, b) => a.priority - b.priority),
    safeCorridors,
    avoidCorridors,
    optimalHeading: bestCell?.heading ?? currentHeading,
    optimalSpeed: bestCell?.speed ?? currentSpeed,
    currentRisk,
    recommendedRisk: bestCell?.costFactor ?? currentRisk,
    currentCell,
    bestCell,
    matrix, headings, speeds, Tr,
  };
}
