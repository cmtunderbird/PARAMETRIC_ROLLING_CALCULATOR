// ─── CompassRose — SVG directional display ──────────────────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { DEG_TO_RAD } from "../../physics.js";

export default function CompassRose({ waveDir, swellDir, shipHeading, size = 160 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 16;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function arrowPath(angleDeg, color, len, label) {
    const rad = (angleDeg - 90) * DEG_TO_RAD;
    const ex = cx + len * Math.cos(rad), ey = cy + len * Math.sin(rad);
    const ax1 = ex + 6 * Math.cos(rad + 2.6), ay1 = ey + 6 * Math.sin(rad + 2.6);
    const ax2 = ex + 6 * Math.cos(rad - 2.6), ay2 = ey + 6 * Math.sin(rad - 2.6);
    return (
      <g key={label}>
        <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth="2.5" opacity="0.9" />
        <polygon points={`${ex},${ey} ${ax1},${ay1} ${ax2},${ay2}`} fill={color} />
        <text x={ex + 12 * Math.cos(rad)} y={ey + 12 * Math.sin(rad)}
          fill={color} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </text>
      </g>
    );
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: size }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#334155" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r * 0.65} fill="none" stroke="#1E293B"
        strokeWidth="0.8" strokeDasharray="3,3" />
      {dirs.map((d, i) => {
        const a = (i * 45 - 90) * DEG_TO_RAD;
        const tx = cx + (r + 10) * Math.cos(a);
        const ty = cy + (r + 10) * Math.sin(a);
        return (
          <text key={d} x={tx} y={ty} textAnchor="middle" dominantBaseline="middle"
            fill={d === "N" ? "#F59E0B" : "#64748B"}
            style={{ fontSize: d === "N" ? 11 : 9, fontWeight: d === "N" ? 800 : 500,
              fontFamily: "'JetBrains Mono', monospace" }}>
            {d}
          </text>
        );
      })}
      {shipHeading != null && arrowPath(shipHeading, "#3B82F6", r * 0.55, "HDG")}
      {waveDir != null && arrowPath(waveDir, "#EF4444", r * 0.7, "WAV")}
      {swellDir != null && arrowPath(swellDir, "#F59E0B", r * 0.6, "SWL")}
      <circle cx={cx} cy={cy} r="4" fill="#CBD5E1" />
    </svg>
  );
}
