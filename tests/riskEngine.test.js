// ─── riskEngine.test.js — Tests for the decision/recommendation engine ───────
// Phase 2, Item 11

import { describe, it, expect } from "vitest";
import { buildRiskMatrix, generateRecommendation } from "../src/core/riskEngine.js";

const baseSeaState = {
  waveHeight_m: 4, wavePeriod_s: 10, waveDir_deg: 180,
  swellHeight_m: 1.5, swellPeriod_s: 12, swellDir_deg: 200,
  windSpeed_kts: 25,
};

const baseVessel = {
  Lwl: 260, B: 32.2, d: 12.0, GM: 1.5, rollDamping: 0.05,
  bowFreeboard: 7.0, fp_from_midship: 130.0, bridge_from_midship: -105.0,
};

describe("buildRiskMatrix", () => {
  it("returns matrix with correct dimensions", () => {
    const { matrix, headings, speeds } = buildRiskMatrix({ ...baseSeaState, ...baseVessel });
    expect(headings.length).toBe(72);   // 360/5
    expect(speeds.length).toBe(21);     // 4-24 kts inclusive
    expect(matrix.length).toBe(72);
    expect(matrix[0].length).toBe(21);
  });

  it("each cell has required fields", () => {
    const { matrix } = buildRiskMatrix({ ...baseSeaState, ...baseVessel });
    const cell = matrix[0][0];
    expect(cell).toHaveProperty("heading");
    expect(cell).toHaveProperty("speed");
    expect(cell).toHaveProperty("costFactor");
    expect(cell).toHaveProperty("zone");
    expect(["safe", "marginal", "dangerous", "forbidden"]).toContain(cell.zone);
  });

  it("calm seas produce mostly safe matrix", () => {
    const { matrix } = buildRiskMatrix({
      waveHeight_m: 0.5, wavePeriod_s: 5, waveDir_deg: 0,
      windSpeed_kts: 5, ...baseVessel,
    });
    const safeCount = matrix.flat().filter(c => c.zone === "safe").length;
    const total = matrix.flat().length;
    expect(safeCount / total).toBeGreaterThan(0.8);
  });
});

describe("generateRecommendation", () => {
  it("returns NONE severity when current point is safe", () => {
    const rec = generateRecommendation({
      waveHeight_m: 0.5, wavePeriod_s: 5, waveDir_deg: 0,
      windSpeed_kts: 5, ...baseVessel,
      currentHeading: 90, currentSpeed: 12,
    });
    expect(rec.severity).toBe("NONE");
    expect(rec.actions.length).toBe(0);
  });

  it("returns actions when current point is dangerous", () => {
    const rec = generateRecommendation({
      ...baseSeaState, ...baseVessel,
      currentHeading: 180, currentSpeed: 18,
    });
    expect(["ELEVATED", "HIGH", "CRITICAL"]).toContain(rec.severity);
    expect(rec.actions.length).toBeGreaterThan(0);
  });

  it("recommends ALTER_COURSE or REDUCE_SPEED actions", () => {
    const rec = generateRecommendation({
      ...baseSeaState, ...baseVessel,
      currentHeading: 0, currentSpeed: 16,
    });
    if (rec.severity !== "NONE") {
      const types = rec.actions.map(a => a.type);
      const hasValidAction = types.some(t =>
        ["ALTER_COURSE", "REDUCE_SPEED", "ALTER_COURSE_AND_SPEED"].includes(t));
      expect(hasValidAction).toBe(true);
    }
  });

  it("provides safe corridors", () => {
    const rec = generateRecommendation({
      ...baseSeaState, ...baseVessel,
      currentHeading: 180, currentSpeed: 18,
    });
    expect(rec.safeCorridors).toBeDefined();
    expect(Array.isArray(rec.safeCorridors)).toBe(true);
  });

  it("optimal point has lower risk than current", () => {
    const rec = generateRecommendation({
      ...baseSeaState, ...baseVessel,
      currentHeading: 180, currentSpeed: 18,
    });
    if (rec.severity !== "NONE") {
      expect(rec.recommendedRisk).toBeLessThanOrEqual(rec.currentRisk);
    }
  });

  it("summary is a non-empty string", () => {
    const rec = generateRecommendation({
      ...baseSeaState, ...baseVessel,
      currentHeading: 90, currentSpeed: 12,
    });
    expect(typeof rec.summary).toBe("string");
    expect(rec.summary.length).toBeGreaterThan(0);
  });

  it("actions are sorted by priority", () => {
    const rec = generateRecommendation({
      ...baseSeaState, ...baseVessel,
      currentHeading: 0, currentSpeed: 20,
    });
    for (let i = 1; i < rec.actions.length; i++) {
      expect(rec.actions[i].priority).toBeGreaterThanOrEqual(rec.actions[i-1].priority);
    }
  });

  it("extreme conditions produce elevated or higher severity", () => {
    const rec = generateRecommendation({
      waveHeight_m: 5.5, wavePeriod_s: 10, waveDir_deg: 180,
      swellHeight_m: 3, swellPeriod_s: 14, swellDir_deg: 180,
      windSpeed_kts: 50, ...baseVessel,
      currentHeading: 180, currentSpeed: 20,
    });
    expect(["ELEVATED", "HIGH", "CRITICAL"]).toContain(rec.severity);
  });
});
