// ─── physics.test.js — Unit tests for the seakeeping physics engine ──────────
// Phase 1, Item 6 — first 20+ tests protecting physics.js
// Reference values from Bhattacharyya (1978), IMO MSC.1/Circ.1228,
// ISO 15016 STAWAVE-1, and windmar seakeeping model.

import { describe, it, expect } from "vitest";
import {
  G, KTS_TO_MS, DEG_TO_RAD,
  calcNaturalRollPeriod,
  calcWaveLength,
  calcEncounterPeriod,
  calcEncounterFrequency,
  calcParametricRiskRatio,
  calcSynchronousRiskRatio,
  getRiskLevel,
  calcRollAmplitude,
  calcPitchAmplitude,
  calcSlammingProbability,
  calcGreenWaterProbability,
  calcParametricRollRisk,
  calcKwonSpeedLossPct,
  calcMotions,
  getSafetyCostFactor,
  getMotionStatus,
  SafetyLimits,
  calcHeaveAccel,
  calcPointAccel,
} from "../src/physics.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Natural Roll Period — IMO MSC method
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcNaturalRollPeriod", () => {
  it("computes correct Tr for large container vessel (IMO method)", () => {
    // B=48.2, GM=1.8, d=14.5, Lwl=350
    // C = 0.373 + 0.023*(48.2/14.5) - 0.043*(350/100) = 0.2990
    // Tr = 2 * 0.2990 * 48.2 / sqrt(1.8) = 21.47s
    const Tr = calcNaturalRollPeriod(48.2, 1.8, 14.5, 350);
    expect(Tr).toBeCloseTo(21.47, 1);
  });

  it("computes correct Tr for VLCC tanker", () => {
    // B=58, GM=5.5, d=20.5, Lwl=320
    // C = 0.373 + 0.023*(58/20.5) - 0.043*(320/100) = 0.373+0.065-0.138 = 0.300
    // Tr = 2 * 0.300 * 58 / sqrt(5.5) = 34.8 / 2.345 = 14.84s
    const Tr = calcNaturalRollPeriod(58, 5.5, 20.5, 320);
    expect(Tr).toBeCloseTo(14.84, 1);
  });

  it("returns Infinity for zero GM (unstable vessel)", () => {
    expect(calcNaturalRollPeriod(32, 0, 10, 200)).toBe(Infinity);
  });

  it("returns Infinity for negative GM", () => {
    expect(calcNaturalRollPeriod(32, -0.5, 10, 200)).toBe(Infinity);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Wave Length
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcWaveLength", () => {
  it("deep-water dispersion: λ = g·T²/(2π)", () => {
    // T=10s → λ = 9.81*100/6.2832 = 156.13m
    expect(calcWaveLength(10)).toBeCloseTo(156.13, 0);
  });

  it("returns 0 for zero period", () => {
    expect(calcWaveLength(0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Encounter Period — head, beam, following, surf-riding
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcEncounterPeriod", () => {
  it("head seas (180°) shortens encounter period", () => {
    // Tw=10, V=15kts, heading=180° relative
    // Vw = g*10/(2π) = 15.61 m/s, V_ms = 7.72 m/s
    // denom = 1 - (7.72 * cos(180°))/15.61 = 1 + 0.494 = 1.494
    // Te = 10/1.494 ≈ 6.69s
    const Te = calcEncounterPeriod(10, 15, 180);
    expect(Te).toBeCloseTo(6.69, 1);
  });

  it("beam seas (90°) leaves period unchanged", () => {
    // cos(90°) = 0 → denom = 1 → Te = Tw
    const Te = calcEncounterPeriod(10, 15, 90);
    expect(Te).toBeCloseTo(10, 1);
  });

  it("following seas (0°) lengthens encounter period", () => {
    // cos(0°) = 1 → denom = 1 - 0.494 = 0.506 → Te = 19.76s
    const Te = calcEncounterPeriod(10, 15, 0);
    expect(Te).toBeCloseTo(19.76, 1);
  });

  it("near surf-riding caps at 200s", () => {
    // Very high speed in following seas → denom ≈ 0
    const Te = calcEncounterPeriod(8, 30, 0);
    expect(Te).toBeLessThanOrEqual(200);
  });

  it("zero wave period returns 200", () => {
    expect(calcEncounterPeriod(0, 15, 90)).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Parametric & Synchronous Risk Ratios
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcParametricRiskRatio", () => {
  it("returns 1.0 at exact resonance (Tr = 2·Te)", () => {
    // Tr=20, Te=10 → ratio = 20/(2*10) = 1.0
    expect(calcParametricRiskRatio(20, 10)).toBeCloseTo(1.0);
  });

  it("returns 0.5 when Te = Tr (far from parametric resonance)", () => {
    expect(calcParametricRiskRatio(20, 20)).toBeCloseTo(0.5);
  });

  it("returns null for zero Te", () => {
    expect(calcParametricRiskRatio(20, 0)).toBeNull();
  });

  it("returns null for zero Tr", () => {
    expect(calcParametricRiskRatio(0, 10)).toBeNull();
  });
});

describe("calcSynchronousRiskRatio", () => {
  it("returns 1.0 at synchronous resonance (Tr = Te)", () => {
    expect(calcSynchronousRiskRatio(14, 14)).toBeCloseTo(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Risk Level Classification
// ═══════════════════════════════════════════════════════════════════════════════
describe("getRiskLevel", () => {
  it("CRITICAL when |ratio-1| ≤ 0.1", () => {
    expect(getRiskLevel(1.0).level).toBe("CRITICAL");
    expect(getRiskLevel(0.95).level).toBe("CRITICAL");
    expect(getRiskLevel(1.08).level).toBe("CRITICAL");
  });

  it("HIGH when |ratio-1| ≤ 0.2", () => {
    expect(getRiskLevel(0.85).level).toBe("HIGH");
    expect(getRiskLevel(1.15).level).toBe("HIGH");
  });

  it("ELEVATED when |ratio-1| ≤ 0.3", () => {
    expect(getRiskLevel(0.75).level).toBe("ELEVATED");
  });

  it("MODERATE when |ratio-1| ≤ 0.4", () => {
    expect(getRiskLevel(0.65).level).toBe("MODERATE");
  });

  it("LOW when |ratio-1| ≤ 0.5", () => {
    expect(getRiskLevel(0.55).level).toBe("LOW");
  });

  it("MINIMAL when |ratio-1| > 0.5", () => {
    expect(getRiskLevel(0.3).level).toBe("MINIMAL");
    expect(getRiskLevel(2.0).level).toBe("MINIMAL");
  });

  it("UNKNOWN for null input", () => {
    expect(getRiskLevel(null).level).toBe("UNKNOWN");
  });

  it("severity increases with proximity to resonance", () => {
    expect(getRiskLevel(1.0).severity).toBeGreaterThan(getRiskLevel(0.7).severity);
    expect(getRiskLevel(0.85).severity).toBeGreaterThan(getRiskLevel(0.5).severity);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Wave Length ratio check (ship length vs wavelength)
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcWaveLength (ship context)", () => {
  it("λ ≈ Lwl is the danger zone for parametric rolling", () => {
    // For Lwl=200m, the dangerous wave period satisfies g·T²/(2π) ≈ 200
    // T = sqrt(200 * 2π / g) = sqrt(128.1) = 11.32s
    const dangerousTw = Math.sqrt(200 * 2 * Math.PI / G);
    const lambda = calcWaveLength(dangerousTw);
    expect(lambda).toBeCloseTo(200, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Kwon Speed Loss
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcKwonSpeedLossPct", () => {
  it("returns 0 for calm seas", () => {
    expect(calcKwonSpeedLossPct(0, 0, 0, 0.75, 200)).toBe(0);
  });

  it("head seas (0° relative) produce maximum speed loss", () => {
    const headLoss = calcKwonSpeedLossPct(3, 180, 180, 0.75, 200);
    const beamLoss = calcKwonSpeedLossPct(3, 90, 0, 0.75, 200);
    expect(headLoss).toBeGreaterThan(beamLoss);
  });

  it("higher waves produce more speed loss", () => {
    const loss3m = calcKwonSpeedLossPct(3, 0, 0, 0.75, 200);
    const loss5m = calcKwonSpeedLossPct(5, 0, 0, 0.75, 200);
    expect(loss5m).toBeGreaterThan(loss3m);
  });

  it("never exceeds 50%", () => {
    expect(calcKwonSpeedLossPct(10, 0, 0, 0.5, 100)).toBeLessThanOrEqual(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Safety Cost Factor — the graduated penalty system
// ═══════════════════════════════════════════════════════════════════════════════
describe("getSafetyCostFactor", () => {
  it("returns 1.0 for safe motions", () => {
    const motions = { roll: 5, pitch: 2, bridgeAcc: 1.0, slam: 0.01, greenWater: 0 };
    expect(getSafetyCostFactor(motions, 2, 15)).toBe(1.0);
  });

  it("returns > 1.0 for marginal roll", () => {
    const motions = { roll: 20, pitch: 3, bridgeAcc: 1.0, slam: 0.01, greenWater: 0 };
    const cost = getSafetyCostFactor(motions, 3, 20);
    expect(cost).toBeGreaterThan(1.0);
    expect(cost).toBeLessThan(2.0);
  });

  it("returns >= 2.0 for dangerous roll", () => {
    const motions = { roll: 32, pitch: 5, bridgeAcc: 2.0, slam: 0.05, greenWater: 0 };
    expect(getSafetyCostFactor(motions, 4, 30)).toBeGreaterThanOrEqual(2.0);
  });

  it("returns Infinity for extreme wave height (hard avoidance)", () => {
    const motions = { roll: 10, pitch: 3, bridgeAcc: 1.0, slam: 0.01, greenWater: 0 };
    expect(getSafetyCostFactor(motions, 6.5, 20)).toBe(Infinity);
  });

  it("returns Infinity for storm-force wind (hard avoidance)", () => {
    const motions = { roll: 10, pitch: 3, bridgeAcc: 1.0, slam: 0.01, greenWater: 0 };
    expect(getSafetyCostFactor(motions, 3, 75)).toBe(Infinity);
  });

  it("returns 1.0 for null motions (no data)", () => {
    expect(getSafetyCostFactor(null, 2, 15)).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Motion Status Labels
// ═══════════════════════════════════════════════════════════════════════════════
describe("getMotionStatus", () => {
  it("SAFE for calm conditions", () => {
    const motions = { roll: 5, pitch: 2, bridgeAcc: 1.0, slam: 0.01, greenWater: 0 };
    expect(getMotionStatus(motions, 2, 15).label).toBe("SAFE");
  });

  it("FORBIDDEN for extreme waves", () => {
    const motions = { roll: 5, pitch: 2, bridgeAcc: 1.0, slam: 0.01, greenWater: 0 };
    expect(getMotionStatus(motions, 7, 30).label).toBe("FORBIDDEN");
  });

  it("DANGEROUS for heavy rolling", () => {
    const motions = { roll: 32, pitch: 8, bridgeAcc: 3.0, slam: 0.12, greenWater: 0.1 };
    expect(getMotionStatus(motions, 4, 30).label).toBe("DANGEROUS");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Full Motion Response (calcMotions)
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcMotions", () => {
  const baseParams = {
    waveHeight_m: 3, wavePeriod_s: 10, waveDir_deg: 180,
    swellHeight_m: 1.5, swellPeriod_s: 12, swellDir_deg: 200,
    heading_deg: 0, speed_kts: 15,
    Lwl: 200, B: 32, GM: 2.5, Tr: 14,
    rollDamping: 0.05,
    bowFreeboard: 6.0, fp_from_midship: 88.0, bridge_from_midship: -70.0,
  };

  it("returns non-null for valid inputs", () => {
    const m = calcMotions(baseParams);
    expect(m).not.toBeNull();
  });

  it("produces positive roll amplitude", () => {
    const m = calcMotions(baseParams);
    expect(m.roll).toBeGreaterThan(0);
    expect(m.roll).toBeLessThanOrEqual(45); // capped at 45°
  });

  it("produces positive pitch amplitude", () => {
    const m = calcMotions(baseParams);
    expect(m.pitch).toBeGreaterThan(0);
    expect(m.pitch).toBeLessThanOrEqual(20); // capped at 20°
  });

  it("RSS combination: combined > individual components", () => {
    const combined = calcMotions(baseParams);
    const waveOnly = calcMotions({ ...baseParams, swellHeight_m: 0 });
    expect(combined.roll).toBeGreaterThanOrEqual(waveOnly.roll);
  });

  it("returns null for zero wave and zero swell", () => {
    expect(calcMotions({ ...baseParams, waveHeight_m: 0, swellHeight_m: 0 })).toBeNull();
  });

  it("slamming probability is between 0 and 1", () => {
    const m = calcMotions(baseParams);
    expect(m.slam).toBeGreaterThanOrEqual(0);
    expect(m.slam).toBeLessThanOrEqual(1);
  });

  it("parametric risk is between 0 and 1", () => {
    const m = calcMotions(baseParams);
    expect(m.paramRisk).toBeGreaterThanOrEqual(0);
    expect(m.paramRisk).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Slamming Probability (Ochi criteria)
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcSlammingProbability", () => {
  it("returns 0 for high freeboard / calm seas", () => {
    expect(calcSlammingProbability(0.5, 8, 15, 10, 0, 1, 88)).toBe(0);
  });

  it("increases with wave height", () => {
    const p2 = calcSlammingProbability(2, 10, 6, 15, 0, 3, 88);
    const p5 = calcSlammingProbability(5, 10, 6, 15, 0, 5, 88);
    expect(p5).toBeGreaterThan(p2);
  });

  it("never exceeds 1.0", () => {
    expect(calcSlammingProbability(8, 8, 2, 20, 0, 10, 88)).toBeLessThanOrEqual(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Parametric Roll Risk (3-factor model)
// ═══════════════════════════════════════════════════════════════════════════════
describe("calcParametricRollRisk", () => {
  it("returns ~1.0 when all three factors align (period + length + heading)", () => {
    // Te ≈ Tr/2, λ ≈ Lwl, head seas
    const Tr = 14, Lwl = 156;
    const lambda = 156; // λ ≈ Lwl
    const Te = 7;       // Te ≈ Tr/2 = 7
    const risk = calcParametricRollRisk(lambda, Te, Tr, 0, Lwl); // 0° = head
    expect(risk).toBeGreaterThan(0.7);
  });

  it("returns ~0 for beam seas (heading risk ≈ 0)", () => {
    const risk = calcParametricRollRisk(200, 7, 14, 90, 200);
    expect(risk).toBeCloseTo(0, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Constants sanity checks
// ═══════════════════════════════════════════════════════════════════════════════
describe("Constants", () => {
  it("G = 9.81 m/s²", () => { expect(G).toBe(9.81); });
  it("KTS_TO_MS ≈ 0.51444", () => { expect(KTS_TO_MS).toBeCloseTo(0.51444, 4); });
  it("DEG_TO_RAD = π/180", () => { expect(DEG_TO_RAD).toBeCloseTo(Math.PI / 180, 10); });
  it("SafetyLimits.maxWaveHeight_m = 6.0", () => { expect(SafetyLimits.maxWaveHeight_m).toBe(6.0); });
  it("SafetyLimits.maxWindSpeed_kts = 70.0", () => { expect(SafetyLimits.maxWindSpeed_kts).toBe(70.0); });
});
