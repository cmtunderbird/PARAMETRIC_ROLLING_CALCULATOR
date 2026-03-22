// ─── RiskGauge — SVG arc gauge for risk ratios ──────────────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { DEG_TO_RAD, getRiskLevel } from "../../physics.js";

export default function RiskGauge({ value, label, maxDev = 0.6 }) {
  const risk = getRiskLevel(value);
  const angle = value !== null
    ? Math.min(Math.max((value - 0.4) / 1.2, 0), 1) * 180 - 90
    : -90;
  const r = 72;
  const cx = 90, cy = 88;
  const arcSegments = [
    { start: -90, end: -54, color: "#0D9488" },
    { start: -54, end: -18, color: "#16A34A" },
    { start: -18, end: 18,  color: "#CA8A04" },
    { start: 18,  end: 54,  color: "#EA580C" },
    { start: 54,  end: 90,  color: "#DC2626" },
  ];
  function polarToCart(angleDeg, radius) {
    const rad = (angleDeg - 90) * DEG_TO_RAD;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 180 120" style={{ width: "100%", maxWidth: 200 }}>
        {arcSegments.map((seg, i) => {
          const s = polarToCart(seg.start, r);
          const e = polarToCart(seg.end, r);
          return (
            <path key={i}
              d={`M${s.x},${s.y} A${r},${r} 0 0,1 ${e.x},${e.y}`}
              fill="none" stroke={seg.color} strokeWidth="10"
              strokeLinecap="round" opacity="0.3" />
          );
        })}
        {value !== null && (
          <line x1={cx} y1={cy}
            x2={cx + 58 * Math.cos((angle - 90) * DEG_TO_RAD)}
            y2={cy + 58 * Math.sin((angle - 90) * DEG_TO_RAD)}
            stroke={risk.color} strokeWidth="3" strokeLinecap="round" />
        )}
        <circle cx={cx} cy={cy} r="6" fill={risk.color} />
        <text x={cx} y={cy + 24} textAnchor="middle" fill={risk.color}
          style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
          {value !== null ? value.toFixed(3) : "---"}
        </text>
      </svg>
      <div style={{ color: risk.color, fontWeight: 700, fontSize: 11,
        letterSpacing: "0.08em", marginTop: -6 }}>{risk.level}</div>
      <div style={{ color: "#94A3B8", fontSize: 10, marginTop: 2,
        textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
    </div>
  );
}
