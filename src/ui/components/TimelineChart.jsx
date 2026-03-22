// ─── TimelineChart — 7-day forecast with risk backdrop ──────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { DEG_TO_RAD, calcEncounterPeriod, calcParametricRiskRatio, getRiskLevel } from "../../physics.js";

export default function TimelineChart({ data, shipParams, hourOffset, onHourChange }) {
  if (!data || data.length === 0) return null;
  const W = 720, H = 180, pad = { t: 20, r: 20, b: 30, l: 45 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const maxWh = Math.max(...data.map(d => d.waveHeight ?? 0), 1);
  const maxPeriod = Math.max(...data.map(d => d.wavePeriod ?? 0), 1);
  const step = pw / (data.length - 1 || 1);

  const waveLine = data.map((d, i) => {
    const x = pad.l + i * step;
    const y = pad.t + ph - ((d.waveHeight ?? 0) / maxWh) * ph;
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");

  const periodLine = data.map((d, i) => {
    const x = pad.l + i * step;
    const y = pad.t + ph - ((d.wavePeriod ?? 0) / maxPeriod) * ph;
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");

  const riskPoints = data.map((d, i) => {
    if (!d.wavePeriod || !shipParams.Tr) return null;
    const Te = calcEncounterPeriod(d.wavePeriod, shipParams.speed, shipParams.relHeading);
    const ratio = calcParametricRiskRatio(shipParams.Tr, Te);
    if (ratio === null) return null;
    const risk = getRiskLevel(ratio);
    const x = pad.l + i * step;
    return { x, risk, ratio };
  }).filter(Boolean);

  const selX = pad.l + hourOffset * step;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", cursor: "crosshair" }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width * W;
        const idx = Math.round(Math.max(0, Math.min(data.length - 1, (mx - pad.l) / step)));
        onHourChange(idx);
      }}>
      <rect x={pad.l} y={pad.t} width={pw} height={ph} fill="#0F172A" rx="4" />
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <g key={f}>
          <line x1={pad.l} y1={pad.t + ph * (1 - f)} x2={pad.l + pw} y2={pad.t + ph * (1 - f)}
            stroke="#1E293B" strokeWidth="0.5" />
          <text x={pad.l - 4} y={pad.t + ph * (1 - f) + 3} textAnchor="end" fill="#64748B"
            style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            {(maxWh * f).toFixed(1)}m
          </text>
        </g>
      ))}
      {riskPoints.map((p, i) => (
        <rect key={i} x={p.x - step / 2} y={pad.t} width={step} height={ph}
          fill={p.risk.color} opacity={0.08 + p.risk.severity * 0.04} />
      ))}
      <path d={waveLine} fill="none" stroke="#3B82F6" strokeWidth="1.8" />
      <path d={periodLine} fill="none" stroke="#F59E0B" strokeWidth="1.2"
        strokeDasharray="4,3" opacity="0.7" />
      <line x1={selX} y1={pad.t} x2={selX} y2={pad.t + ph}
        stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3,2" />
      {data.filter((_, i) => i % 24 === 0).map((d, j) => {
        const x = pad.l + (j * 24) * step;
        const date = new Date(d.time);
        return (
          <text key={j} x={x} y={H - 8} textAnchor="middle" fill="#64748B"
            style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            {date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </text>
        );
      })}
      <g transform={`translate(${pad.l + 8}, ${pad.t + 12})`}>
        <rect x="-4" y="-8" width="140" height="28" fill="#0F172A" opacity="0.85" rx="3" />
        <line x1="0" y1="0" x2="16" y2="0" stroke="#3B82F6" strokeWidth="2" />
        <text x="20" y="3" fill="#94A3B8"
          style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>Wave Height (m)</text>
        <line x1="0" y1="12" x2="16" y2="12" stroke="#F59E0B" strokeWidth="1.2" strokeDasharray="4,3" />
        <text x="20" y="15" fill="#94A3B8"
          style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>Wave Period (s)</text>
      </g>
    </svg>
  );
}
