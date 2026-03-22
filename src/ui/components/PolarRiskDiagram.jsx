// ─── PolarRiskDiagram — heading/speed risk polar plot ────────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { DEG_TO_RAD, calcEncounterPeriod, calcParametricRiskRatio } from "../../physics.js";

export default function PolarRiskDiagram({ shipParams }) {
  const size = 260, cx = size / 2, cy = size / 2, maxR = 100;
  const speeds = [5, 10, 15, 20];
  const angles = Array.from({ length: 37 }, (_, i) => i * 10);
  const Tw = shipParams.wavePeriod || 10;
  const Tr = shipParams.Tr;

  if (!Tr || Tr <= 0) return (
    <div style={{ color: "#64748B", fontSize: 12, textAlign: "center", padding: 20 }}>
      Enter ship parameters to view polar diagram
    </div>
  );

  const speedColors = ["#22D3EE", "#3B82F6", "#A855F7", "#EC4899"];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: size }}>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke="#1E293B" strokeWidth="0.5" />
      ))}
      {[0, 45, 90, 135].map(a => {
        const rad = a * DEG_TO_RAD;
        return (
          <g key={a}>
            <line x1={cx - maxR * Math.sin(rad)} y1={cy - maxR * Math.cos(rad)}
              x2={cx + maxR * Math.sin(rad)} y2={cy + maxR * Math.cos(rad)}
              stroke="#1E293B" strokeWidth="0.5" />
          </g>
        );
      })}
      <text x={cx} y={cy - maxR - 6} textAnchor="middle" fill="#F59E0B"
        style={{ fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>HEAD</text>
      <text x={cx} y={cy + maxR + 12} textAnchor="middle" fill="#94A3B8"
        style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>FOLLOW</text>
      <text x={cx + maxR + 6} y={cy + 3} textAnchor="start" fill="#94A3B8"
        style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>BEAM</text>
      <circle cx={cx} cy={cy} r={maxR * 0.2} fill="#DC2626" opacity="0.06" />
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
        const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z";
        return (
          <path key={si} d={path} fill={speedColors[si]} fillOpacity="0.08"
            stroke={speedColors[si]} strokeWidth="1.5" opacity="0.8" />
        );
      })}
      <g transform={`translate(${size - 70}, ${size - 55})`}>
        <rect x="-4" y="-4" width="68" height={speeds.length * 14 + 6}
          fill="#0F172A" opacity="0.9" rx="3" />
        {speeds.map((s, i) => (
          <g key={i} transform={`translate(0, ${i * 14})`}>
            <line x1="0" y1="5" x2="14" y2="5" stroke={speedColors[i]} strokeWidth="2" />
            <text x="18" y="8" fill="#94A3B8"
              style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>{s} kts</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
