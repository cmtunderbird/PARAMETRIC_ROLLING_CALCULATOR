// ─── PolarRiskDiagram — heading/speed risk polar with safe corridor overlay ──
// Phase 2, Item 14 — enhanced with recommendation engine integration
// Shows: risk intensity per heading, safe corridors (green arcs), avoid corridors
// (red arcs), current heading marker, and arrow to nearest safe heading when in danger.
import { useMemo } from "react";
import { DEG_TO_RAD, calcEncounterPeriod, calcParametricRiskRatio } from "../../physics.js";

// ── Arc path generator for SVG ──────────────────────────────────────────────
function arcPath(cx, cy, r, startDeg, endDeg) {
  if (startDeg === endDeg) return "";
  const s = (startDeg - 90) * DEG_TO_RAD;
  const e = (endDeg - 90) * DEG_TO_RAD;
  const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
  const sweep = (endDeg - startDeg + 360) % 360;
  const large = sweep > 180 ? 1 : 0;
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
}

// ── Angular distance (handles wrap-around) ──────────────────────────────────
function angDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

export default function PolarRiskDiagram({ shipParams, safeCorridors, avoidCorridors, currentHeading }) {
  const size = 280, cx = size / 2, cy = size / 2, maxR = 108;
  const speeds = [5, 10, 15, 20];
  const angles = Array.from({ length: 73 }, (_, i) => i * 5); // 5° resolution
  const Tw = shipParams.wavePeriod || 10;
  const Tr = shipParams.Tr;

  if (!Tr || Tr <= 0) return (
    <div style={{ color: "#64748B", fontSize: 12, textAlign: "center", padding: 20 }}>
      Enter ship parameters to view polar diagram
    </div>
  );

  const speedColors = ["#22D3EE", "#3B82F6", "#A855F7", "#EC4899"];
  const hdg = currentHeading ?? shipParams.heading ?? null;

  // ── Find nearest safe heading when current heading is in danger ──
  const nearestSafe = useMemo(() => {
    if (hdg === null || !safeCorridors?.length) return null;
    // Check if current heading is already in a safe corridor
    const inSafe = safeCorridors.some(c => {
      if (c.from <= c.to) return hdg >= c.from && hdg <= c.to;
      return hdg >= c.from || hdg <= c.to; // wrap-around
    });
    if (inSafe) return null;
    // Find closest edge of any safe corridor
    let best = null, bestDist = 360;
    for (const c of safeCorridors) {
      for (const edge of [c.from, c.to]) {
        const d = angDist(hdg, edge);
        if (d < bestDist) { bestDist = d; best = edge; }
      }
    }
    return best;
  }, [hdg, safeCorridors]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: size }}>
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>

      {/* Grid circles */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke="#1E293B" strokeWidth="0.5" />
      ))}
      {/* Grid lines */}
      {[0, 45, 90, 135].map(a => {
        const rad = a * DEG_TO_RAD;
        return <line key={a} x1={cx - maxR * Math.sin(rad)} y1={cy - maxR * Math.cos(rad)}
          x2={cx + maxR * Math.sin(rad)} y2={cy + maxR * Math.cos(rad)}
          stroke="#1E293B" strokeWidth="0.5" />;
      })}

      {/* ── Safe corridor overlays (green arcs) ── */}
      {safeCorridors?.map((c, i) => (
        <path key={`safe-${i}`} d={arcPath(cx, cy, maxR + 6, c.from, c.to)}
          fill="#16A34A" fillOpacity="0.12" stroke="#16A34A" strokeWidth="1.5" strokeOpacity="0.5" />
      ))}

      {/* ── Avoid corridor overlays (red arcs) ── */}
      {avoidCorridors?.map((c, i) => (
        <path key={`avoid-${i}`} d={arcPath(cx, cy, maxR + 6, c.from, c.to)}
          fill="#DC2626" fillOpacity="0.1" stroke="#DC2626" strokeWidth="1.5"
          strokeOpacity="0.5" strokeDasharray="4,3" />
      ))}

      {/* Danger zone center */}
      <circle cx={cx} cy={cy} r={maxR * 0.2} fill="#DC2626" opacity="0.06" />

      {/* ── Risk curves per speed ── */}
      {speeds.map((spd, si) => {
        const pts = angles.map(a => {
          const Te = calcEncounterPeriod(Tw, spd, a);
          const ratio = calcParametricRiskRatio(Tr, Te);
          if (ratio === null) return null;
          const dev = Math.abs(ratio - 1);
          const rr = Math.max(0, 1 - dev) * maxR;
          const rad = a * DEG_TO_RAD;
          return { x: cx + rr * Math.sin(rad), y: cy - rr * Math.cos(rad) };
        }).filter(Boolean);
        if (pts.length < 2) return null;
        const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z";
        return <path key={si} d={path} fill={speedColors[si]} fillOpacity="0.08"
          stroke={speedColors[si]} strokeWidth="1.5" opacity="0.8" />;
      })}

      {/* ── Current heading marker (bold line) ── */}
      {hdg !== null && (() => {
        const rad = hdg * DEG_TO_RAD;
        const inDanger = nearestSafe !== null;
        const color = inDanger ? "#EF4444" : "#22C55E";
        return (
          <g>
            <line x1={cx} y1={cy}
              x2={cx + (maxR + 12) * Math.sin(rad)} y2={cy - (maxR + 12) * Math.cos(rad)}
              stroke={color} strokeWidth={2.5} opacity={0.9} filter={inDanger ? "url(#glow)" : undefined}>
              {inDanger && <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />}
            </line>
            {/* Heading label */}
            <text x={cx + (maxR + 20) * Math.sin(rad)} y={cy - (maxR + 20) * Math.cos(rad)}
              textAnchor="middle" fill={color}
              style={{ fontSize: 9, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
              {String(Math.round(hdg)).padStart(3, "0")}°
            </text>
            {/* Ship icon at end of line */}
            <circle cx={cx + (maxR + 6) * Math.sin(rad)} cy={cy - (maxR + 6) * Math.cos(rad)}
              r={4} fill={color} stroke="#0F172A" strokeWidth={1} />
          </g>
        );
      })()}

      {/* ── Arrow to nearest safe heading (shown when in danger) ── */}
      {nearestSafe !== null && hdg !== null && (() => {
        const rad = nearestSafe * DEG_TO_RAD;
        const arrowR = maxR * 0.65;
        const tx = cx + arrowR * Math.sin(rad);
        const ty = cy - arrowR * Math.cos(rad);
        return (
          <g>
            {/* Dashed arc from current to safe */}
            <circle cx={cx} cy={cy} r={arrowR} fill="none"
              stroke="#22C55E" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
            {/* Safe heading arrow target */}
            <circle cx={tx} cy={ty} r={6} fill="#22C55E" fillOpacity="0.3"
              stroke="#22C55E" strokeWidth="1.5">
              <animate attributeName="r" values="6;9;6" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <text x={tx} y={ty + 3} textAnchor="middle" fill="#22C55E"
              style={{ fontSize: 7, fontWeight: 900, fontFamily: "'JetBrains Mono', monospace" }}>
              ➜
            </text>
            {/* Label */}
            <text x={tx + (Math.sin(rad) > 0 ? 12 : -12)} y={ty}
              textAnchor={Math.sin(rad) > 0 ? "start" : "end"} fill="#22C55E"
              style={{ fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {String(nearestSafe).padStart(3, "0")}°
            </text>
          </g>
        );
      })()}

      {/* Cardinal direction labels */}
      <text x={cx} y={cy - maxR - 10} textAnchor="middle" fill="#F59E0B"
        style={{ fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>HEAD</text>
      <text x={cx} y={cy + maxR + 16} textAnchor="middle" fill="#94A3B8"
        style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>FOLLOW</text>
      <text x={cx + maxR + 8} y={cy + 3} textAnchor="start" fill="#94A3B8"
        style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>BEAM</text>

      {/* Legend */}
      <g transform={`translate(${size - 74}, ${size - 80})`}>
        <rect x="-4" y="-4" width="72" height={speeds.length * 13 + 30}
          fill="#0F172A" opacity="0.92" rx="3" stroke="#334155" strokeWidth="0.5" />
        {speeds.map((s, i) => (
          <g key={i} transform={`translate(0, ${i * 13})`}>
            <line x1="0" y1="5" x2="14" y2="5" stroke={speedColors[i]} strokeWidth="2" />
            <text x="18" y="8" fill="#94A3B8"
              style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>{s} kts</text>
          </g>
        ))}
        {/* Corridor legend */}
        <g transform={`translate(0, ${speeds.length * 13 + 2})`}>
          <rect x="0" y="0" width="14" height="6" fill="#16A34A" fillOpacity="0.3" rx="1" />
          <text x="18" y="6" fill="#16A34A" style={{ fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }}>Safe</text>
        </g>
        <g transform={`translate(0, ${speeds.length * 13 + 12})`}>
          <rect x="0" y="0" width="14" height="6" fill="#DC2626" fillOpacity="0.3" rx="1" />
          <text x="18" y="6" fill="#DC2626" style={{ fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }}>Avoid</text>
        </g>
      </g>
    </svg>
  );
}
