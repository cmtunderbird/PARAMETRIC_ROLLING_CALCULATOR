// ─── physics.js ───────────────────────────────────────────────────────────────
// Seakeeping physics engine — Parametric Rolling Calculator
// Upgraded with windmar (windmar-nav/windmar) seakeeping & numba_kernels models
//
// References:
//   Bhattacharyya (1978) "Dynamics of Marine Vehicles"
//   IMO MSC.1/Circ.1228 "Revised Guidance for Avoiding Dangerous Situations"
//   ISO 15016 STAWAVE-1 Added Resistance in Waves
//   Kwon (2008) speed-loss empirical method
//   Ochi (1964) slamming probability criteria
//   ISO 2631-3:1985 Whole-body vibration limits

export const G = 9.81;
export const KTS_TO_MS = 0.51444;
export const DEG_TO_RAD = Math.PI / 180;

// ─── SafetyLimits — hard avoidance + graduated motion limits ─────────────────
// Mirrors windmar SafetyLimits for MR Product Tanker (generalised defaults)
export const SafetyLimits = {
  maxWaveHeight_m:    6.0,   // Hs >= 6m → forbidden (BF 9+)
  maxWindSpeed_kts:   70.0,  // >= 70 kts → storm force 12
  maxRollSafe:        15.0,  // deg — normal operations
  maxRollMarginal:    25.0,  // deg — reduced operations
  maxRollDangerous:   30.0,  // deg
  maxPitchSafe:        5.0,  // deg
  maxPitchMarginal:    8.0,
  maxPitchDangerous:  12.0,
  maxAccelSafe:    0.2 * 9.81,  // ~2 m/s² comfortable
  maxAccelMarginal:0.3 * 9.81,
  maxAccelDangerous:0.5 * 9.81,
  maxSlamSafe:    0.03,  // 3%
  maxSlamMarginal:0.10,  // 10%
  maxParamRollRisk:0.30, // threshold for warning
};

// ─── SeakeepingSpecs — vessel-specific seakeeping parameters ─────────────────
// Internal default factory — not exported (unused outside physics.js)
function makeSeakeepingSpecs(overrides = {}) {
  return {
    gm_laden:            2.5,   // m
    gm_ballast:          4.0,
    roll_period_laden:  14.0,   // s
    roll_period_ballast:10.0,
    roll_damping:        0.05,  // non-dim (typical tanker w/o bilge keels)
    kg_laden:            8.5,   // m above keel
    kg_ballast:         10.0,
    fp_from_midship:    88.0,   // m (half Lpp for MR tanker)
    bridge_from_midship:-70.0,  // m (aft)
    bow_freeboard_laden:  6.0,  // m
    bow_freeboard_ballast:12.0,
    ...overrides,
  };
}

// ─── Encounter Frequency (deep-water dispersion, windmar formula) ────────────
// Standard form: omega_e = |omega - omega² * V_ms * cos(alpha) / G|
// For following seas (alpha→0, cos→1) at high speed the denominator of Te
// approaches zero — we clamp Te to a physically meaningful floor of 200s
// (beyond which parametric rolling is not possible) rather than 0.01 rad/s.
export function calcEncounterFrequency(Tw, V_kts, headingRel_deg) {
  if (Tw <= 0) return 0.01;
  const omega = (2 * Math.PI) / Tw;
  const V_ms  = V_kts * KTS_TO_MS;
  const alpha = headingRel_deg * DEG_TO_RAD;
  const omega_e = Math.abs(omega - (omega * omega * V_ms * Math.cos(alpha)) / G);
  // Floor: Te_max = 200s → omega_e_min = 2π/200 ≈ 0.0314 rad/s
  // Replaces the old arbitrary 0.01 floor which suppressed resonance detection
  return omega_e < (2 * Math.PI / 200) ? (2 * Math.PI / 200) : omega_e;
}

export function calcEncounterPeriod(Tw, V_kts, headingRel_deg) {
  if (Tw <= 0) return 200;
  const omega   = (2 * Math.PI) / Tw;
  const V_ms    = V_kts * KTS_TO_MS;
  const alpha   = headingRel_deg * DEG_TO_RAD;
  const cosA    = Math.cos(alpha);
  // Wave celerity: Vw = g / omega (deep water)
  const Vw      = G / omega;
  // Avoid division by zero when ship speed equals wave celerity in following seas
  const denom   = 1 - (V_ms * cosA) / Vw;
  if (Math.abs(denom) < 0.01) return 200;   // surf-riding — Te undefined, cap at 200s
  const Te = Math.abs(Tw / denom);
  return Te > 200 ? 200 : Te;               // cap at 200s (no practical resonance beyond)
}

// ─── Natural Roll Period — IMO MSC method ────────────────────────────────────
export function calcNaturalRollPeriod(B, GM, d, Lwl, method = "imo") {
  if (GM <= 0 || B <= 0) return Infinity;
  if (method === "imo") {
    const C = 0.373 + 0.023 * (B / d) - 0.043 * (Lwl / 100);
    return (2 * C * B) / Math.sqrt(GM);
  }
  const k = 0.39 * B;
  return (2 * Math.PI * k) / Math.sqrt(G * GM);
}

// ─── Wave Length ─────────────────────────────────────────────────────────────
export function calcWaveLength(Tw) {
  return (G * Tw * Tw) / (2 * Math.PI);
}

// ─── Risk Ratio Helpers (kept for backward compat) ───────────────────────────
export function calcParametricRiskRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / (2 * Te);
}
export function calcSynchronousRiskRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / Te;
}

export function getRiskLevel(ratio) {
  if (ratio === null) return { level: "UNKNOWN", color: "#6B7280", severity: 0 };
  const dev = Math.abs(ratio - 1.0);
  if (dev <= 0.1) return { level: "CRITICAL", color: "#DC2626", severity: 5 };
  if (dev <= 0.2) return { level: "HIGH",     color: "#EA580C", severity: 4 };
  if (dev <= 0.3) return { level: "ELEVATED", color: "#D97706", severity: 3 };
  if (dev <= 0.4) return { level: "MODERATE", color: "#CA8A04", severity: 2 };
  if (dev <= 0.5) return { level: "LOW",      color: "#16A34A", severity: 1 };
  return           { level: "MINIMAL",  color: "#0D9488", severity: 0 };
}
export function getRiskSeverity(ratio) { return getRiskLevel(ratio).severity; }
export function getRiskLabel(severity) {
  return ["MINIMAL","LOW","MODERATE","ELEVATED","HIGH","CRITICAL"][severity] || "UNKNOWN";
}

// ─── SDOF Roll Amplitude — windmar calculate_roll ────────────────────────────
// Single-degree-of-freedom linear response model with RAO and damping
export function calcRollAmplitude(waveHeight_m, wavePeriod_s, encounterAngle_deg,
                                   omega_e, omega_roll, gm, rollDamping = 0.05) {
  const waveLength_m = calcWaveLength(wavePeriod_s);
  if (waveLength_m <= 0 || gm <= 0) return 0;
  const waveSlope = waveHeight_m / waveLength_m;
  const beamFactor = Math.abs(Math.sin(encounterAngle_deg * DEG_TO_RAD));
  const effectiveSlope = waveSlope * beamFactor;
  const excitation = (effectiveSlope * G) / gm;
  const freqRatio = omega_e / omega_roll;
  const denom = Math.sqrt(
    Math.pow(1 - freqRatio * freqRatio, 2) +
    Math.pow(2 * rollDamping * freqRatio, 2)
  );
  const rao = 1.0 / (denom < 0.1 ? 0.1 : denom);
  const rollAmp = (180 / Math.PI) * excitation * rao * (waveHeight_m / 2);
  return Math.min(rollAmp, 45.0);
}

// ─── Pitch Amplitude — windmar calculate_pitch ───────────────────────────────
export function calcPitchAmplitude(waveHeight_m, wavePeriod_s, encounterAngle_deg, Lwl) {
  const waveLength_m = calcWaveLength(wavePeriod_s);
  if (waveLength_m <= 0 || Lwl <= 0) return { pitch: 0, pitchPeriod: 0 };
  const l_lambda = Lwl / waveLength_m;
  const headFactor = Math.abs(Math.cos(encounterAngle_deg * DEG_TO_RAD));
  const waveSlope = waveHeight_m / waveLength_m;
  let pitchFactor;
  if (l_lambda < 0.5)       pitchFactor = 2.0 * l_lambda;
  else if (l_lambda < 1.5)  pitchFactor = 1.0 - 0.3 * Math.abs(l_lambda - 1.0);
  else                       pitchFactor = 0.5 / l_lambda;
  const pitch = Math.min((180 / Math.PI) * waveSlope * headFactor * pitchFactor * 10, 20.0);
  const pitchPeriod = 0.55 * Math.sqrt(Lwl);
  return { pitch, pitchPeriod };
}

// ─── Heave + Point Accelerations — windmar kernels ───────────────────────────
export function calcHeaveAccel(waveHeight_m, omega_e, encounterAngle_deg) {
  const heaveAmp = waveHeight_m / 2;
  const beamFactor = Math.abs(Math.cos(encounterAngle_deg * DEG_TO_RAD));
  return heaveAmp * omega_e * omega_e * (0.3 + 0.7 * beamFactor);
}
export function calcPointAccel(heaveAccel, pitchAmp_deg, omega_e, distFromMidship) {
  const pitchRad = pitchAmp_deg * DEG_TO_RAD;
  const pitchAccel = Math.abs(distFromMidship) * pitchRad * omega_e * omega_e;
  return Math.sqrt(heaveAccel * heaveAccel + pitchAccel * pitchAccel);
}

// ─── Slamming Probability — Ochi's criteria ──────────────────────────────────
export function calcSlammingProbability(waveHeight_m, wavePeriod_s, bowFreeboard,
                                         speed_kts, encounterAngle_deg,
                                         pitchAmp_deg, fp_from_midship = 88.0) {
  const speed_ms = speed_kts * KTS_TO_MS;
  const pitchRad = pitchAmp_deg * DEG_TO_RAD;
  const bowVerticalMotion = waveHeight_m / 2 + fp_from_midship * pitchRad;
  if (bowVerticalMotion < 0.1) return 0;
  const emergenceRatio = bowFreeboard / bowVerticalMotion;
  if (emergenceRatio > 3.0) return 0;
  const probEmergence = Math.exp(-2 * emergenceRatio * emergenceRatio);
  const headFactor = (1 + Math.cos(encounterAngle_deg * DEG_TO_RAD)) / 2;
  const speedFactor = Math.min(speed_ms / 8.0, 2.0);
  return Math.min(probEmergence * headFactor * speedFactor, 1.0);
}

// ─── Green Water Probability ──────────────────────────────────────────────────
export function calcGreenWaterProbability(waveHeight_m, bowFreeboard,
                                           pitchAmp_deg, fp_from_midship = 88.0) {
  const pitchRad = pitchAmp_deg * DEG_TO_RAD;
  const effectiveFreeboard = bowFreeboard - fp_from_midship * pitchRad;
  const relativeMotion = waveHeight_m / 2;
  if (effectiveFreeboard <= 0) return 1.0;
  if (relativeMotion < 0.1) return 0;
  const ratio = effectiveFreeboard / relativeMotion;
  return ratio > 3.0 ? 0 : Math.min(Math.exp(-2 * ratio * ratio), 1.0);
}

// ─── Parametric Roll Risk 0-1 — windmar 3-factor model ───────────────────────
// period_risk × length_risk × heading_risk
// More physically complete than ratio-deviation alone
export function calcParametricRollRisk(waveLength_m, encounterPeriod_s,
                                        rollPeriod_s, encounterAngle_deg, Lwl) {
  // 1. Period resonance: Te ≈ Tr/2
  const periodRatio = encounterPeriod_s / (rollPeriod_s / 2);
  const periodRisk = Math.abs(periodRatio - 1.0) < 0.3
    ? 1.0 - Math.abs(periodRatio - 1.0) / 0.3
    : 0.0;

  // 2. Wavelength resonance: λ ≈ L_ship
  const l_lambda = Lwl > 0 ? Lwl / waveLength_m : 0;
  const lengthRisk = (l_lambda > 0.8 && l_lambda < 1.2)
    ? 1.0 - Math.abs(l_lambda - 1.0) / 0.2
    : 0.0;

  // 3. Heading risk: head/following seas (cos closest to ±1)
  const headFollow = Math.abs(Math.cos(encounterAngle_deg * DEG_TO_RAD));
  const headingRisk = headFollow > 0.7 ? 1.0 : headFollow / 0.7;

  return periodRisk * lengthRisk * headingRisk;
}

// ─── Kwon Speed Loss — involuntary speed reduction ───────────────────────────
export function calcKwonSpeedLossPct(waveHeight_m, waveDir_deg, heading_deg, Cb, Lwl) {
  if (waveHeight_m <= 0 || Lwl <= 0) return 0;
  const relAngle = Math.abs(((waveDir_deg - heading_deg) + 180) % 360 - 180);
  const cbFactor = 1.7 - 0.9 * Cb;
  const lengthFactor = Math.min(Math.max(180.0 / Lwl, 0.5), 1.5);
  const baseLoss = 3.0 * cbFactor * lengthFactor;
  let dirFactor;
  if (relAngle <= 30)       dirFactor = 1.0;
  else if (relAngle <= 60)  dirFactor = 0.9;
  else if (relAngle <= 90)  dirFactor = 0.7;
  else if (relAngle <= 150) dirFactor = 0.4;
  else                       dirFactor = 0.2;
  return Math.min(baseLoss * waveHeight_m * dirFactor, 50.0);
}

// ─── Full Motion Response ─────────────────────────────────────────────────────
// Computes all motions in one call — decomposed swell + windwave with RSS
export function calcMotions({
  waveHeight_m, wavePeriod_s, waveDir_deg,
  swellHeight_m = 0, swellPeriod_s = 0, swellDir_deg = 0,
  heading_deg, speed_kts,
  Lwl, B, GM, Tr, rollDamping = 0.05,
  bowFreeboard = 6.0, fp_from_midship = 88.0, bridge_from_midship = -70.0,
}) {
  function _one(Hs, Tp, Wdir) {
    if (!Hs || !Tp || Hs <= 0 || Tp <= 0) return null;
    const encAngle = ((Wdir - heading_deg + 180) % 360);
    const encAngleAdj = encAngle > 180 ? 360 - encAngle : encAngle;
    const omega_e = calcEncounterFrequency(Tp, speed_kts, encAngleAdj);
    const omega_roll = Tr > 0 ? (2 * Math.PI) / Tr : 0.45;
    const Te = (2 * Math.PI) / omega_e;
    const waveLen = calcWaveLength(Tp);
    const roll = calcRollAmplitude(Hs, Tp, encAngleAdj, omega_e, omega_roll, GM, rollDamping);
    const { pitch, pitchPeriod } = calcPitchAmplitude(Hs, Tp, encAngleAdj, Lwl);
    const heaveAcc = calcHeaveAccel(Hs, omega_e, encAngleAdj);
    const bowAcc = calcPointAccel(heaveAcc, pitch, omega_e, fp_from_midship);
    const bridgeAcc = calcPointAccel(heaveAcc, pitch, omega_e, bridge_from_midship);
    const slam = calcSlammingProbability(Hs, Tp, bowFreeboard, speed_kts, encAngleAdj, pitch, fp_from_midship);
    const greenWater = calcGreenWaterProbability(Hs, bowFreeboard, pitch, fp_from_midship);
    const paramRisk = calcParametricRollRisk(waveLen, Te, Tr, encAngleAdj, Lwl);
    return { roll, pitch, pitchPeriod, heaveAcc, bowAcc, bridgeAcc,
             slam, greenWater, paramRisk, Te, omega_e, encAngle: encAngleAdj };
  }
  const w = _one(waveHeight_m, wavePeriod_s, waveDir_deg);
  const s = swellHeight_m > 0 ? _one(swellHeight_m, swellPeriod_s, swellDir_deg) : null;
  if (!w && !s) return null;
  if (!s) return w;
  if (!w) return s;
  // RSS combination (windmar spectral superposition)
  const rss = (a, b) => Math.sqrt(a * a + b * b);
  const dominant = s.roll > w.roll ? s : w;
  return {
    roll:        Math.min(rss(w.roll, s.roll), 45.0),
    pitch:       Math.min(rss(w.pitch, s.pitch), 20.0),
    pitchPeriod: dominant.pitchPeriod,
    heaveAcc:    rss(w.heaveAcc, s.heaveAcc),
    bowAcc:      rss(w.bowAcc, s.bowAcc),
    bridgeAcc:   rss(w.bridgeAcc, s.bridgeAcc),
    slam:        Math.max(w.slam, s.slam),
    greenWater:  Math.max(w.greenWater, s.greenWater),
    paramRisk:   Math.max(w.paramRisk, s.paramRisk),
    Te:          dominant.Te,
    omega_e:     dominant.omega_e,
    encAngle:    dominant.encAngle,
  };
}

// ─── Safety Cost Factor — windmar get_safety_cost_factor ─────────────────────
// Returns penalty multiplier: 1.0 = safe | >1 = penalised | Infinity = blocked
export function getSafetyCostFactor(motions, waveHeight_m, windSpeed_kts = 0,
                                     skipHardLimits = false) {
  // Hard avoidance limits
  if (waveHeight_m >= SafetyLimits.maxWaveHeight_m)
    return skipHardLimits ? 10.0 : Infinity;
  if (windSpeed_kts >= SafetyLimits.maxWindSpeed_kts)
    return skipHardLimits ? 10.0 : Infinity;
  if (!motions) return 1.0;

  const rollRatio  = motions.roll  / SafetyLimits.maxRollDangerous;
  const pitchRatio = motions.pitch / SafetyLimits.maxPitchDangerous;

  const isDangerousRoll  = motions.roll  >= SafetyLimits.maxRollDangerous;
  const isDangerousPitch = motions.pitch >= SafetyLimits.maxPitchDangerous;
  const isDangerousAccel = motions.bridgeAcc >= SafetyLimits.maxAccelDangerous;
  const isDangerousSlam  = motions.slam >= SafetyLimits.maxSlamMarginal;

  if (isDangerousRoll || isDangerousPitch || isDangerousAccel || isDangerousSlam) {
    const exceedance = Math.max(rollRatio, pitchRatio);
    if (exceedance > 1.5) return Infinity;
    if (exceedance > 1.0) return 2.0 + ((exceedance - 1.0) / 0.5) * 3.0;
    return 2.0;
  }
  const isMarginalRoll  = motions.roll  >= SafetyLimits.maxRollSafe;
  const isMarginalPitch = motions.pitch >= SafetyLimits.maxPitchSafe;
  if (isMarginalRoll || isMarginalPitch) {
    const rollPenalty  = Math.max(0, motions.roll  - SafetyLimits.maxRollSafe)  / 10;
    const pitchPenalty = Math.max(0, motions.pitch - SafetyLimits.maxPitchSafe) / 5;
    return 1.0 + rollPenalty + pitchPenalty;
  }
  return 1.0;
}

// ─── Overall Status Label ─────────────────────────────────────────────────────
export function getMotionStatus(motions, waveHeight_m, windSpeed_kts = 0) {
  const factor = getSafetyCostFactor(motions, waveHeight_m, windSpeed_kts);
  if (!isFinite(factor)) return { label: "FORBIDDEN", color: "#7C3AED", severity: 6 };
  if (factor >= 2.0)     return { label: "DANGEROUS", color: "#DC2626",  severity: 5 };
  if (factor >= 1.5)     return { label: "HAZARDOUS", color: "#EA580C",  severity: 4 };
  if (factor > 1.0)      return { label: "MARGINAL",  color: "#D97706",  severity: 3 };
  return                        { label: "SAFE",       color: "#16A34A",  severity: 1 };
}

// ─── Meteo overlay risk intensity (0-1) ──────────────────────────────────────
export function calcRiskIntensity(Tw, waveDir, shipTr, shipSpeed, shipHeading, Lwl = 200) {
  if (!Tw || !shipTr || shipTr <= 0) return 0;
  const relAngle = waveDir != null ? ((waveDir - (shipHeading || 0) + 180) % 360) : 0;
  const Te = calcEncounterPeriod(Tw, shipSpeed || 15, relAngle);
  if (!isFinite(Te) || Te <= 0) return 0;
  const waveLen = calcWaveLength(Tw);
  return calcParametricRollRisk(waveLen, Te, shipTr, relAngle, Lwl);
}
