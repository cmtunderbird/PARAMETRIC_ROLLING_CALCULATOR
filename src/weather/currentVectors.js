// ─── currentVectors.js — Ocean current integration for SOG adjustment ───────
// Phase 3, Item 25
// Fetches ocean current data (CMEMS GLORYS via existing bridge) and integrates
// into SOG calculation. Currents affect encounter frequency by changing
// speed-over-ground. Important in Gulf Stream, Agulhas, Kuroshio, etc.

import { KTS_TO_MS } from "../physics.js";

/**
 * Adjust ship speed for ocean current effect on encounter frequency.
 * @param {number} sogKts — speed over ground in knots
 * @param {number} headingDeg — ship heading (degrees true)
 * @param {number} currentSpeed — current speed (m/s)
 * @param {number} currentDir — current direction (degrees true, direction TOWARDS)
 * @returns {{ effectiveSpeed: number, sogAdjusted: number, currentEffect: string }}
 */
export function adjustSpeedForCurrent(sogKts, headingDeg, currentSpeed, currentDir) {
  if (!currentSpeed || currentSpeed < 0.01)
    return { effectiveSpeed: sogKts, sogAdjusted: sogKts, currentEffect: "negligible" };

  const headingRad = (headingDeg * Math.PI) / 180;
  const currentRad = (currentDir * Math.PI) / 180;

  // Current component along ship's heading (positive = with ship, negative = against)
  const alongShip = currentSpeed * Math.cos(currentRad - headingRad);
  const alongKts = alongShip / KTS_TO_MS;

  // Speed through water (what matters for wave encounter) is SOG minus current
  const stwKts = sogKts - alongKts;
  const effectiveSpeed = Math.max(0, stwKts);

  // Classify the effect
  const effect = Math.abs(alongKts) < 0.5 ? "negligible"
    : alongKts > 0 ? "favourable" : "adverse";

  return { effectiveSpeed, sogAdjusted: effectiveSpeed, currentEffect: effect,
    currentAlongKts: Math.round(alongKts * 10) / 10 };
}

/**
 * Compute current set and drift for display.
 * @param {number} currentU — eastward component (m/s)
 * @param {number} currentV — northward component (m/s)
 * @returns {{ speed: number, direction: number, speedKts: number }}
 */
export function computeSetDrift(currentU, currentV) {
  if (currentU == null || currentV == null)
    return { speed: 0, direction: 0, speedKts: 0 };
  const speed = Math.sqrt(currentU * currentU + currentV * currentV);
  const direction = ((Math.atan2(currentU, currentV) * 180) / Math.PI + 360) % 360;
  return {
    speed: Math.round(speed * 1000) / 1000,
    direction: Math.round(direction),
    speedKts: Math.round((speed / KTS_TO_MS) * 10) / 10,
  };
}

/**
 * Check if ocean currents are significant at a given point.
 * Threshold: 0.5 kts — below this, current effect on encounter period is negligible.
 */
export function isCurrentSignificant(currentSpeed_ms) {
  return currentSpeed_ms != null && (currentSpeed_ms / KTS_TO_MS) >= 0.5;
}
