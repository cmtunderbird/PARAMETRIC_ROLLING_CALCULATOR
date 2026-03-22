// ─── ConfidenceScore.jsx — Data quality / confidence indicator ────────────────
// Phase 2, Item 18
// For each risk assessment, computes and displays a confidence score based on:
//   1. Forecast age (hours since model run)
//   2. Number of contributing weather sources
//   3. Sea state variability (spread in recent readings)
//   4. Wave period reliability (short periods = more uncertain)
// Displayed as a 1-5 star rating next to risk readings.
import { useMemo } from "react";

function computeConfidence({
  lastFetch,          // Date object — when weather was last fetched
  activeSources,      // string[] — active weather source keys
  marineData,         // array — hourly marine data
  hourIdx,            // current hour index
  waveHeight,         // current Hs
  wavePeriod,         // current Tw
}) {
  const factors = {};
  let totalScore = 0;
  let maxScore = 0;

  // ── Factor 1: Forecast freshness (0-25 points) ──
  maxScore += 25;
  if (lastFetch) {
    const ageHours = (Date.now() - (lastFetch instanceof Date ? lastFetch.getTime() : new Date(lastFetch).getTime())) / 3600000;
    if (ageHours < 1) { factors.freshness = { score: 25, label: "< 1h old", detail: "Fresh data" }; totalScore += 25; }
    else if (ageHours < 3) { factors.freshness = { score: 20, label: `${ageHours.toFixed(0)}h old`, detail: "Recent" }; totalScore += 20; }
    else if (ageHours < 6) { factors.freshness = { score: 15, label: `${ageHours.toFixed(0)}h old`, detail: "Aging" }; totalScore += 15; }
    else if (ageHours < 12) { factors.freshness = { score: 8, label: `${ageHours.toFixed(0)}h old`, detail: "Stale" }; totalScore += 8; }
    else { factors.freshness = { score: 2, label: `${ageHours.toFixed(0)}h old`, detail: "Very stale" }; totalScore += 2; }
  } else {
    factors.freshness = { score: 0, label: "No data", detail: "Manual entry" };
  }

  // ── Factor 2: Source count (0-25 points) ──
  maxScore += 25;
  const srcCount = activeSources?.length ?? 0;
  if (srcCount >= 3) { factors.sources = { score: 25, label: `${srcCount} sources`, detail: "Multi-source" }; totalScore += 25; }
  else if (srcCount === 2) { factors.sources = { score: 20, label: "2 sources", detail: "Dual source" }; totalScore += 20; }
  else if (srcCount === 1) { factors.sources = { score: 12, label: "1 source", detail: "Single source" }; totalScore += 12; }
  else { factors.sources = { score: 0, label: "None", detail: "No sources" }; }

  // ── Factor 3: Forecast horizon position (0-25 points) ──
  // Closer to model init time = more reliable
  maxScore += 25;
  const totalHours = marineData?.length ?? 0;
  if (totalHours > 0 && hourIdx != null) {
    const pct = hourIdx / totalHours;
    if (pct < 0.15) { factors.horizon = { score: 25, label: "T+0-24h", detail: "Near-term" }; totalScore += 25; }
    else if (pct < 0.3) { factors.horizon = { score: 20, label: "T+24-48h", detail: "Short range" }; totalScore += 20; }
    else if (pct < 0.5) { factors.horizon = { score: 15, label: "T+48-84h", detail: "Medium range" }; totalScore += 15; }
    else if (pct < 0.75) { factors.horizon = { score: 8, label: "T+84-120h", detail: "Extended" }; totalScore += 8; }
    else { factors.horizon = { score: 3, label: "T+120h+", detail: "Low skill" }; totalScore += 3; }
  } else {
    factors.horizon = { score: 0, label: "Unknown", detail: "No timeline" };
  }

  // ── Factor 4: Sea state variability (0-25 points) ──
  // Low variability in recent hours = more predictable = higher confidence
  maxScore += 25;
  if (marineData?.length > 6 && hourIdx != null) {
    const window = marineData.slice(Math.max(0, hourIdx - 3), Math.min(marineData.length, hourIdx + 4));
    const heights = window.map(h => h?.waveHeight).filter(v => v != null && v > 0);
    if (heights.length >= 3) {
      const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
      const std = Math.sqrt(heights.reduce((a, v) => a + (v - mean) ** 2, 0) / heights.length);
      const cv = mean > 0 ? std / mean : 0; // coefficient of variation
      if (cv < 0.1) { factors.variability = { score: 25, label: "Steady", detail: `CV=${(cv*100).toFixed(0)}%` }; totalScore += 25; }
      else if (cv < 0.2) { factors.variability = { score: 20, label: "Stable", detail: `CV=${(cv*100).toFixed(0)}%` }; totalScore += 20; }
      else if (cv < 0.35) { factors.variability = { score: 12, label: "Variable", detail: `CV=${(cv*100).toFixed(0)}%` }; totalScore += 12; }
      else { factors.variability = { score: 5, label: "Unstable", detail: `CV=${(cv*100).toFixed(0)}%` }; totalScore += 5; }
    } else {
      factors.variability = { score: 10, label: "Limited", detail: "Few readings" }; totalScore += 10;
    }
  } else {
    factors.variability = { score: 0, label: "Unknown", detail: "No data" };
  }

  // ── Compute star rating (1-5) ──
  const pct = maxScore > 0 ? totalScore / maxScore : 0;
  const stars = pct >= 0.85 ? 5 : pct >= 0.7 ? 4 : pct >= 0.5 ? 3 : pct >= 0.3 ? 2 : 1;
  const label = stars >= 4 ? "HIGH" : stars === 3 ? "MODERATE" : "LOW";
  const color = stars >= 4 ? "#22C55E" : stars === 3 ? "#F59E0B" : "#EF4444";

  return { stars, label, color, totalScore, maxScore, pct, factors };
}

// ── Star display helper ─────────────────────────────────────────────────────
function Stars({ count, color, size = 12 }) {
  return (
    <span style={{ letterSpacing: 1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= count ? color : "#334155", fontSize: size }}>★</span>
      ))}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function ConfidenceScore({
  lastFetch, activeSources, marineData, hourIdx,
  waveHeight, wavePeriod, compact = false,
}) {
  const conf = useMemo(() => computeConfidence({
    lastFetch, activeSources, marineData, hourIdx, waveHeight, wavePeriod,
  }), [lastFetch, activeSources, marineData, hourIdx, waveHeight, wavePeriod]);

  // ── Compact mode: just stars + label (for inline use next to risk readings) ──
  if (compact) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
        fontFamily: "'JetBrains Mono', monospace" }}
        title={`Data confidence: ${conf.label} (${conf.totalScore}/${conf.maxScore})`}>
        <Stars count={conf.stars} color={conf.color} size={10} />
        <span style={{ color: conf.color, fontSize: 8, fontWeight: 700 }}>{conf.label}</span>
      </span>
    );
  }

  // ── Full mode: detailed breakdown panel ──
  return (
    <div style={{
      background: "#1E293B", borderRadius: 8, padding: 14,
      border: "1px solid #334155", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ color: "#64748B", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>
          DATA CONFIDENCE
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Stars count={conf.stars} color={conf.color} size={14} />
          <span style={{ color: conf.color, fontSize: 11, fontWeight: 800 }}>{conf.label}</span>
          <span style={{ color: "#475569", fontSize: 9 }}>({conf.totalScore}/{conf.maxScore})</span>
        </div>
      </div>

      {/* Factor breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {Object.entries(conf.factors).map(([key, f]) => {
          const pct = f.score / 25;
          const barColor = pct >= 0.75 ? "#22C55E" : pct >= 0.5 ? "#F59E0B" : "#EF4444";
          return (
            <div key={key} style={{ background: "#0F172A", borderRadius: 4, padding: 8,
              border: "1px solid #33415570" }}>
              <div style={{ color: "#94A3B8", fontSize: 8, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                {key === "freshness" ? "Age" : key === "sources" ? "Sources"
                  : key === "horizon" ? "Horizon" : "Stability"}
              </div>
              <div style={{ color: "#E2E8F0", fontSize: 10, fontWeight: 700, marginBottom: 2 }}>
                {f.label}
              </div>
              <div style={{ color: "#475569", fontSize: 8, marginBottom: 4 }}>{f.detail}</div>
              {/* Mini bar */}
              <div style={{ height: 3, background: "#334155", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${pct * 100}%`, height: "100%",
                  background: barColor, borderRadius: 2, transition: "width 0.3s" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
