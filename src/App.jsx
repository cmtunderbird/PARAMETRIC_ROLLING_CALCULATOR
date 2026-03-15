import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants & Physics Engine ───────────────────────────────────────────────
const G = 9.81;
const KTS_TO_MS = 0.51444;
const DEG_TO_RAD = Math.PI / 180;

function calcNaturalRollPeriod(B, GM, d, Lwl, method = "imo") {
  if (GM <= 0 || B <= 0) return Infinity;
  if (method === "imo") {
    const C = 0.373 + 0.023 * (B / d) - 0.043 * (Lwl / 100);
    return 2 * C * B / Math.sqrt(GM);
  }
  const k = 0.39 * B;
  return (2 * Math.PI * k) / Math.sqrt(G * GM);
}

function calcWaveLength(Tw) {
  return (G * Tw * Tw) / (2 * Math.PI);
}

function calcEncounterPeriod(Tw, V_kts, headingRel) {
  if (Tw <= 0) return Tw;
  const V = V_kts * KTS_TO_MS;
  const alpha = headingRel * DEG_TO_RAD;
  const waveSpeed = (G * Tw) / (2 * Math.PI);
  const denom = 1 - (V * Math.cos(alpha)) / waveSpeed;
  if (Math.abs(denom) < 0.01) return Infinity;
  return Tw / Math.abs(denom);
}

function calcParametricRiskRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / (2 * Te);
}

function calcSynchronousRiskRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / Te;
}

// ─── Nautical Coordinate Helpers (DD-MM.M N/S, DDD-MM.M E/W) ─────────────
function decimalToNautical(decimal, isLat) {
  const hemi = isLat ? (decimal >= 0 ? "N" : "S") : (decimal >= 0 ? "E" : "W");
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const min = parseFloat(((abs - deg) * 60).toFixed(1));
  return { deg, min, hemi };
}

function nauticalToDecimal(deg, min, hemi) {
  const decimal = deg + min / 60;
  return (hemi === "S" || hemi === "W") ? -decimal : decimal;
}

function formatNauticalLat(deg, min, hemi) {
  return `${String(deg).padStart(2, "0")}°-${min.toFixed(1).padStart(4, "0")}′ ${hemi}`;
}

function formatNauticalLon(deg, min, hemi) {
  return `${String(deg).padStart(3, "0")}°-${min.toFixed(1).padStart(4, "0")}′ ${hemi}`;
}

function getRiskLevel(ratio) {
  if (ratio === null) return { level: "UNKNOWN", color: "#6B7280", severity: 0 };
  const dev = Math.abs(ratio - 1.0);
  if (dev <= 0.1) return { level: "CRITICAL", color: "#DC2626", severity: 5 };
  if (dev <= 0.2) return { level: "HIGH", color: "#EA580C", severity: 4 };
  if (dev <= 0.3) return { level: "ELEVATED", color: "#D97706", severity: 3 };
  if (dev <= 0.4) return { level: "MODERATE", color: "#CA8A04", severity: 2 };
  if (dev <= 0.5) return { level: "LOW", color: "#16A34A", severity: 1 };
  return { level: "MINIMAL", color: "#0D9488", severity: 0 };
}

// ─── Weather API Functions ────────────────────────────────────────────────────
const WEATHER_SOURCES = {
  "open-meteo-marine": {
    name: "Open-Meteo Marine",
    desc: "DWD ICON + ECMWF WAM wave models",
    free: true,
    buildUrl: (lat, lon) =>
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction&forecast_days=7&timeformat=unixtime`,
    parse: (data) => {
      const h = data.hourly;
      return h.time.map((t, i) => ({
        time: t * 1000,
        waveHeight: h.wave_height?.[i] ?? null,
        waveDir: h.wave_direction?.[i] ?? null,
        wavePeriod: h.wave_period?.[i] ?? null,
        swellHeight: h.swell_wave_height?.[i] ?? null,
        swellPeriod: h.swell_wave_period?.[i] ?? null,
        swellDir: h.swell_wave_direction?.[i] ?? null,
        windWaveHeight: h.wind_wave_height?.[i] ?? null,
        windWavePeriod: h.wind_wave_period?.[i] ?? null,
        windWaveDir: h.wind_wave_direction?.[i] ?? null,
      }));
    },
  },
  "open-meteo-weather": {
    name: "Open-Meteo Weather",
    desc: "Wind speed & direction (atmospheric)",
    free: true,
    buildUrl: (lat, lon) =>
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_days=7&timeformat=unixtime`,
    parse: (data) => {
      const h = data.hourly;
      return h.time.map((t, i) => ({
        time: t * 1000,
        windSpeed: h.wind_speed_10m?.[i] ?? null,
        windDir: h.wind_direction_10m?.[i] ?? null,
        windGusts: h.wind_gusts_10m?.[i] ?? null,
      }));
    },
  },
};

async function fetchWeatherData(sourceKey, lat, lon) {
  const src = WEATHER_SOURCES[sourceKey];
  const url = src.buildUrl(lat, lon);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${src.name}: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(`${src.name}: ${data.reason}`);
  return src.parse(data);
}

// ─── SVG Components ───────────────────────────────────────────────────────────
function RiskGauge({ value, label, maxDev = 0.6 }) {
  const risk = getRiskLevel(value);
  const angle = value !== null ? Math.min(Math.max((value - 0.4) / 1.2, 0), 1) * 180 - 90 : -90;
  const r = 72;
  const cx = 90, cy = 88;
  const arcSegments = [
    { start: -90, end: -54, color: "#0D9488" },
    { start: -54, end: -18, color: "#16A34A" },
    { start: -18, end: 18, color: "#CA8A04" },
    { start: 18, end: 54, color: "#EA580C" },
    { start: 54, end: 90, color: "#DC2626" },
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
          return (<path key={i} d={`M${s.x},${s.y} A${r},${r} 0 0,1 ${e.x},${e.y}`} fill="none" stroke={seg.color} strokeWidth="10" strokeLinecap="round" opacity="0.3" />);
        })}
        {value !== null && (<line x1={cx} y1={cy} x2={cx + 58 * Math.cos((angle - 90) * DEG_TO_RAD)} y2={cy + 58 * Math.sin((angle - 90) * DEG_TO_RAD)} stroke={risk.color} strokeWidth="3" strokeLinecap="round" />)}
        <circle cx={cx} cy={cy} r="6" fill={risk.color} />
        <text x={cx} y={cy + 24} textAnchor="middle" fill={risk.color} style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{value !== null ? value.toFixed(3) : "---"}</text>
      </svg>
      <div style={{ color: risk.color, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", marginTop: -6 }}>{risk.level}</div>
      <div style={{ color: "#94A3B8", fontSize: 10, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
    </div>
  );
}

function CompassRose({ waveDir, swellDir, shipHeading, size = 160 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 16;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function arrowPath(angleDeg, color, len, label) {
    const rad = (angleDeg - 90) * DEG_TO_RAD;
    const ex = cx + len * Math.cos(rad), ey = cy + len * Math.sin(rad);
    const ax1 = ex + 6 * Math.cos(rad + 2.6), ay1 = ey + 6 * Math.sin(rad + 2.6);
    const ax2 = ex + 6 * Math.cos(rad - 2.6), ay2 = ey + 6 * Math.sin(rad - 2.6);
    return (<g key={label}><line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth="2.5" opacity="0.9" /><polygon points={`${ex},${ey} ${ax1},${ay1} ${ax2},${ay2}`} fill={color} /><text x={ex + 12 * Math.cos(rad)} y={ey + 12 * Math.sin(rad)} fill={color} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{label}</text></g>);
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: size }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#334155" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r * 0.65} fill="none" stroke="#1E293B" strokeWidth="0.8" strokeDasharray="3,3" />
      {dirs.map((d, i) => { const a = (i * 45 - 90) * DEG_TO_RAD; const tx = cx + (r + 10) * Math.cos(a); const ty = cy + (r + 10) * Math.sin(a); return (<text key={d} x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fill={d === "N" ? "#F59E0B" : "#64748B"} style={{ fontSize: d === "N" ? 11 : 9, fontWeight: d === "N" ? 800 : 500, fontFamily: "'JetBrains Mono', monospace" }}>{d}</text>); })}
      {shipHeading != null && arrowPath(shipHeading, "#3B82F6", r * 0.55, "HDG")}
      {waveDir != null && arrowPath(waveDir, "#EF4444", r * 0.7, "WAV")}
      {swellDir != null && arrowPath(swellDir, "#F59E0B", r * 0.6, "SWL")}
      <circle cx={cx} cy={cy} r="4" fill="#CBD5E1" />
    </svg>
  );
}

function TimelineChart({ data, shipParams, hourOffset, onHourChange }) {
  if (!data || data.length === 0) return null;
  const W = 720, H = 180, pad = { t: 20, r: 20, b: 30, l: 45 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const maxWh = Math.max(...data.map(d => d.waveHeight ?? 0), 1);
  const maxPeriod = Math.max(...data.map(d => d.wavePeriod ?? 0), 1);
  const step = pw / (data.length - 1 || 1);
  const waveLine = data.map((d, i) => { const x = pad.l + i * step; const y = pad.t + ph - ((d.waveHeight ?? 0) / maxWh) * ph; return `${i === 0 ? "M" : "L"}${x},${y}`; }).join(" ");
  const periodLine = data.map((d, i) => { const x = pad.l + i * step; const y = pad.t + ph - ((d.wavePeriod ?? 0) / maxPeriod) * ph; return `${i === 0 ? "M" : "L"}${x},${y}`; }).join(" ");
  const riskPoints = data.map((d, i) => { if (!d.wavePeriod || !shipParams.Tr) return null; const Te = calcEncounterPeriod(d.wavePeriod, shipParams.speed, shipParams.relHeading); const ratio = calcParametricRiskRatio(shipParams.Tr, Te); if (ratio === null) return null; const risk = getRiskLevel(ratio); const x = pad.l + i * step; return { x, risk, ratio }; }).filter(Boolean);
  const selX = pad.l + hourOffset * step;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", cursor: "crosshair" }} onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); const mx = (e.clientX - rect.left) / rect.width * W; const idx = Math.round(Math.max(0, Math.min(data.length - 1, (mx - pad.l) / step))); onHourChange(idx); }}>
      <rect x={pad.l} y={pad.t} width={pw} height={ph} fill="#0F172A" rx="4" />
      {[0, 0.25, 0.5, 0.75, 1].map(f => (<g key={f}><line x1={pad.l} y1={pad.t + ph * (1 - f)} x2={pad.l + pw} y2={pad.t + ph * (1 - f)} stroke="#1E293B" strokeWidth="0.5" /><text x={pad.l - 4} y={pad.t + ph * (1 - f) + 3} textAnchor="end" fill="#64748B" style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>{(maxWh * f).toFixed(1)}m</text></g>))}
      {riskPoints.map((p, i) => (<rect key={i} x={p.x - step / 2} y={pad.t} width={step} height={ph} fill={p.risk.color} opacity={0.08 + p.risk.severity * 0.04} />))}
      <path d={waveLine} fill="none" stroke="#3B82F6" strokeWidth="1.8" />
      <path d={periodLine} fill="none" stroke="#F59E0B" strokeWidth="1.2" strokeDasharray="4,3" opacity="0.7" />
      <line x1={selX} y1={pad.t} x2={selX} y2={pad.t + ph} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3,2" />
      {data.filter((_, i) => i % 24 === 0).map((d, j) => { const x = pad.l + (j * 24) * step; const date = new Date(d.time); return (<text key={j} x={x} y={H - 8} textAnchor="middle" fill="#64748B" style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>{date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</text>); })}
      <g transform={`translate(${pad.l + 8}, ${pad.t + 12})`}><rect x="-4" y="-8" width="140" height="28" fill="#0F172A" opacity="0.85" rx="3" /><line x1="0" y1="0" x2="16" y2="0" stroke="#3B82F6" strokeWidth="2" /><text x="20" y="3" fill="#94A3B8" style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>Wave Height (m)</text><line x1="0" y1="12" x2="16" y2="12" stroke="#F59E0B" strokeWidth="1.2" strokeDasharray="4,3" /><text x="20" y="15" fill="#94A3B8" style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>Wave Period (s)</text></g>
    </svg>
  );
}

function PolarRiskDiagram({ shipParams }) {
  const size = 260, cx = size / 2, cy = size / 2, maxR = 100;
  const speeds = [5, 10, 15, 20];
  const angles = Array.from({ length: 37 }, (_, i) => i * 10);
  const Tw = shipParams.wavePeriod || 10;
  const Tr = shipParams.Tr;
  if (!Tr || Tr <= 0) return <div style={{ color: "#64748B", fontSize: 12, textAlign: "center", padding: 20 }}>Enter ship parameters to view polar diagram</div>;
  const speedColors = ["#22D3EE", "#3B82F6", "#A855F7", "#EC4899"];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: size }}>
      {[0.25, 0.5, 0.75, 1].map(f => (<circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke="#1E293B" strokeWidth="0.5" />))}
      {[0, 45, 90, 135].map(a => { const rad = a * DEG_TO_RAD; return (<g key={a}><line x1={cx - maxR * Math.sin(rad)} y1={cy - maxR * Math.cos(rad)} x2={cx + maxR * Math.sin(rad)} y2={cy + maxR * Math.cos(rad)} stroke="#1E293B" strokeWidth="0.5" /></g>); })}
      <text x={cx} y={cy - maxR - 6} textAnchor="middle" fill="#F59E0B" style={{ fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>HEAD</text>
      <text x={cx} y={cy + maxR + 12} textAnchor="middle" fill="#94A3B8" style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>FOLLOW</text>
      <text x={cx + maxR + 6} y={cy + 3} textAnchor="start" fill="#94A3B8" style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>BEAM</text>
      <circle cx={cx} cy={cy} r={maxR * 0.2} fill="#DC2626" opacity="0.06" />
      {speeds.map((spd, si) => { const pts = angles.map(a => { const Te = calcEncounterPeriod(Tw, spd, a); const ratio = calcParametricRiskRatio(Tr, Te); if (ratio === null) return null; const dev = Math.abs(ratio - 1); const rr = Math.max(0, 1 - dev) * maxR; const rad = a * DEG_TO_RAD; return { x: cx + rr * Math.sin(rad), y: cy - rr * Math.cos(rad) }; }).filter(Boolean); const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z"; return (<path key={si} d={path} fill={speedColors[si]} fillOpacity="0.08" stroke={speedColors[si]} strokeWidth="1.5" opacity="0.8" />); })}
      <g transform={`translate(${size - 70}, ${size - 55})`}><rect x="-4" y="-4" width="68" height={speeds.length * 14 + 6} fill="#0F172A" opacity="0.9" rx="3" />{speeds.map((s, i) => (<g key={i} transform={`translate(0, ${i * 14})`}><line x1="0" y1="5" x2="14" y2="5" stroke={speedColors[i]} strokeWidth="2" /><text x="18" y="8" fill="#94A3B8" style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>{s} kts</text></g>))}</g>
    </svg>
  );
}

// ─── Input Components ─────────────────────────────────────────────────────────
const inputStyle = { background: "#0F172A", border: "1px solid #334155", borderRadius: 4, color: "#E2E8F0", padding: "6px 8px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", width: "100%", boxSizing: "border-box", outline: "none" };
const labelStyle = { color: "#94A3B8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3, display: "block", fontFamily: "'JetBrains Mono', monospace" };

function Field({ label, value, onChange, unit, step = 0.1, min, max }) {
  return (<div style={{ marginBottom: 8 }}><label style={labelStyle}>{label} {unit && <span style={{ color: "#64748B" }}>({unit})</span>}</label><input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} style={inputStyle} onFocus={(e) => e.target.style.borderColor = "#F59E0B"} onBlur={(e) => e.target.style.borderColor = "#334155"} /></div>);
}

const coordFieldStyle = { ...inputStyle, textAlign: "center", padding: "6px 4px" };

function NauticalCoordInput({ label, deg, min, hemi, onDegChange, onMinChange, onHemiChange, isLat }) {
  const maxDeg = isLat ? 90 : 180;
  const hemiOptions = isLat ? ["N", "S"] : ["E", "W"];
  const degWidth = isLat ? "2.2em" : "2.8em";
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>{label} <span style={{ color: "#64748B" }}>({isLat ? "DD-MM.M N/S" : "DDD-MM.M E/W"})</span></label>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <input type="number" value={deg} min={0} max={maxDeg} step={1} onChange={(e) => { let v = parseInt(e.target.value) || 0; v = Math.max(0, Math.min(maxDeg, v)); onDegChange(v); }} style={{ ...coordFieldStyle, width: degWidth, flex: "none" }} onFocus={(e) => e.target.style.borderColor = "#F59E0B"} onBlur={(e) => e.target.style.borderColor = "#334155"} />
        <span style={{ color: "#F59E0B", fontSize: 14, fontWeight: 800, lineHeight: 1 }}>°</span>
        <span style={{ color: "#64748B", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>—</span>
        <input type="number" value={min} min={0} max={59.9} step={0.1} onChange={(e) => { let v = parseFloat(e.target.value) || 0; v = Math.max(0, Math.min(59.9, v)); onMinChange(parseFloat(v.toFixed(1))); }} style={{ ...coordFieldStyle, width: "3.5em", flex: "none" }} onFocus={(e) => e.target.style.borderColor = "#F59E0B"} onBlur={(e) => e.target.style.borderColor = "#334155"} />
        <span style={{ color: "#F59E0B", fontSize: 12, fontWeight: 800, lineHeight: 1 }}>′</span>
        {hemiOptions.map(h => (<button key={h} onClick={() => onHemiChange(h)} style={{ padding: "5px 8px", border: `1px solid ${hemi === h ? "#F59E0B" : "#334155"}`, borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", background: hemi === h ? "#F59E0B" : "#0F172A", color: hemi === h ? "#0F172A" : "#64748B", transition: "all 0.2s", flex: "none", minWidth: 28, textAlign: "center" }}>{h}</button>))}
      </div>
      <div style={{ color: "#475569", fontSize: 9, marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{isLat ? formatNauticalLat(deg, min, hemi) : formatNauticalLon(deg, min, hemi)} = {nauticalToDecimal(deg, min, hemi).toFixed(4)}°</div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
const PRESETS = {
  container_large: { name: "Large Container (14,000 TEU)", Lwl: 350, B: 48.2, d: 14.5, GM: 1.8, Cb: 0.65 },
  container_med: { name: "Medium Container (4,000 TEU)", Lwl: 260, B: 32.2, d: 12.0, GM: 1.5, Cb: 0.62 },
  container_small: { name: "Small Container (1,000 TEU)", Lwl: 150, B: 25.0, d: 8.5, GM: 1.2, Cb: 0.60 },
  pcc: { name: "Pure Car Carrier", Lwl: 199, B: 32.3, d: 9.2, GM: 2.0, Cb: 0.58 },
  tanker: { name: "VLCC Tanker", Lwl: 320, B: 58, d: 20.5, GM: 5.5, Cb: 0.82 },
  bulk: { name: "Capesize Bulker", Lwl: 280, B: 45, d: 17.0, GM: 3.2, Cb: 0.85 },
  roro: { name: "Ro-Ro Ferry", Lwl: 186, B: 28.6, d: 6.8, GM: 1.9, Cb: 0.55 },
  custom: { name: "Custom Vessel", Lwl: 200, B: 32, d: 10, GM: 1.5, Cb: 0.65 },
};

const LOCATIONS = {
  "North Atlantic": { lat: 50.0, lon: -30.0 }, "North Pacific": { lat: 45.0, lon: -170.0 },
  "South China Sea": { lat: 15.0, lon: 115.0 }, "Bay of Biscay": { lat: 45.5, lon: -5.0 },
  "Mediterranean": { lat: 36.0, lon: 18.0 }, "Indian Ocean": { lat: -10.0, lon: 70.0 },
  "Southern Ocean": { lat: -50.0, lon: 0.0 }, "Tasman Sea": { lat: -38.0, lon: 160.0 },
  "Gulf of Mexico": { lat: 25.0, lon: -90.0 }, "Arabian Sea": { lat: 15.0, lon: 62.0 },
};

export default function ParametricRollingCalculator() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [preset, setPreset] = useState("container_large");
  const [ship, setShip] = useState({ ...PRESETS.container_large });
  const [speed, setSpeed] = useState(18);
  const [heading, setHeading] = useState(0);
  const [locationKey, setLocationKey] = useState("North Atlantic");
  const [latDeg, setLatDeg] = useState(50);
  const [latMin, setLatMin] = useState(0.0);
  const [latHemi, setLatHemi] = useState("N");
  const [lonDeg, setLonDeg] = useState(30);
  const [lonMin, setLonMin] = useState(0.0);
  const [lonHemi, setLonHemi] = useState("W");
  const lat = nauticalToDecimal(latDeg, latMin, latHemi);
  const lon = nauticalToDecimal(lonDeg, lonMin, lonHemi);
  const [marineData, setMarineData] = useState(null);
  const [windData, setWindData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hourIdx, setHourIdx] = useState(0);
  const [lastFetch, setLastFetch] = useState(null);
  const [activeSources, setActiveSources] = useState(["open-meteo-marine", "open-meteo-weather"]);
  const updateShip = (key, val) => setShip(prev => ({ ...prev, [key]: val }));
  const applyPreset = (key) => { setPreset(key); setShip({ ...PRESETS[key] }); };
  const applyLocation = (key) => { setLocationKey(key); const loc = LOCATIONS[key]; const nLat = decimalToNautical(loc.lat, true); const nLon = decimalToNautical(loc.lon, false); setLatDeg(nLat.deg); setLatMin(nLat.min); setLatHemi(nLat.hemi); setLonDeg(nLon.deg); setLonMin(nLon.min); setLonHemi(nLon.hemi); };
  const Tr = calcNaturalRollPeriod(ship.B, ship.GM, ship.d, ship.Lwl);
  const currentMarine = marineData?.[hourIdx];
  const currentWind = windData?.[hourIdx];
  const wavePeriod = currentMarine?.wavePeriod ?? 0;
  const waveHeight = currentMarine?.waveHeight ?? 0;
  const waveDir = currentMarine?.waveDir ?? null;
  const swellPeriod = currentMarine?.swellPeriod ?? 0;
  const swellHeight = currentMarine?.swellHeight ?? 0;
  const swellDir = currentMarine?.swellDir ?? null;
  const relHeading = waveDir != null ? ((waveDir - heading + 360) % 360) : 0;
  const Te_wave = calcEncounterPeriod(wavePeriod, speed, relHeading);
  const Te_swell = calcEncounterPeriod(swellPeriod, speed, swellDir != null ? ((swellDir - heading + 360) % 360) : relHeading);
  const paramRatio_wave = calcParametricRiskRatio(Tr, Te_wave);
  const paramRatio_swell = calcParametricRiskRatio(Tr, Te_swell);
  const syncRatio = calcSynchronousRiskRatio(Tr, Te_wave);
  const waveLength = calcWaveLength(wavePeriod);
  const waveLenRatio = ship.Lwl > 0 ? waveLength / ship.Lwl : 0;
  const overallRisk = getRiskLevel(paramRatio_wave !== null && paramRatio_swell !== null ? (Math.abs(paramRatio_wave - 1) < Math.abs(paramRatio_swell - 1) ? paramRatio_wave : paramRatio_swell) : paramRatio_wave ?? paramRatio_swell);
  const fetchData = async () => { setLoading(true); setError(null); try { const results = await Promise.allSettled([activeSources.includes("open-meteo-marine") ? fetchWeatherData("open-meteo-marine", lat, lon) : Promise.resolve(null), activeSources.includes("open-meteo-weather") ? fetchWeatherData("open-meteo-weather", lat, lon) : Promise.resolve(null)]); if (results[0].status === "fulfilled" && results[0].value) setMarineData(results[0].value); if (results[1].status === "fulfilled" && results[1].value) setWindData(results[1].value); const errors = results.filter(r => r.status === "rejected").map(r => r.reason.message); if (errors.length > 0 && results.every(r => r.status === "rejected")) { setError(errors.join("; ")); } setLastFetch(new Date()); setHourIdx(0); } catch (e) { setError(e.message); } setLoading(false); };
  const shipParams = { Tr, speed, relHeading, wavePeriod };
  const sectionHeader = (text) => (<div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #1E293B", paddingBottom: 6, marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>{text}</div>);
  const statBox = (label, value, unit, color = "#E2E8F0") => (<div style={{ textAlign: "center", padding: "6px 4px" }}><div style={{ color, fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{typeof value === "number" ? (isFinite(value) ? value.toFixed(2) : "∞") : value}</div><div style={{ color: "#64748B", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace" }}>{label} {unit && <span style={{ color: "#475569" }}>({unit})</span>}</div></div>);
  const tabBtn = (key, label) => (<button onClick={() => setActiveTab(key)} style={{ padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", background: activeTab === key ? "#F59E0B" : "transparent", color: activeTab === key ? "#0F172A" : "#94A3B8", borderRadius: "4px 4px 0 0", transition: "all 0.2s" }}>{label}</button>);
  const panel = (children, style = {}) => (<div style={{ background: "#1E293B", borderRadius: 8, padding: 16, border: "1px solid #334155", ...style }}>{children}</div>);

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "linear-gradient(135deg, #0B1120 0%, #0F172A 50%, #111827 100%)", color: "#E2E8F0", minHeight: "100vh", padding: 0 }}>
      <div style={{ background: "linear-gradient(90deg, #0F172A, #1E293B, #0F172A)", borderBottom: "2px solid #F59E0B", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#0F172A" }}>⚓</div>
          <div><div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.05em", color: "#F8FAFC" }}>PARAMETRIC ROLLING CALCULATOR</div><div style={{ fontSize: 9, color: "#F59E0B", letterSpacing: "0.2em", textTransform: "uppercase" }}>IMO MSC.1/Circ.1228 Compliant Assessment Tool</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {overallRisk.severity >= 3 && marineData && (<div style={{ background: overallRisk.color + "20", border: `1px solid ${overallRisk.color}`, borderRadius: 4, padding: "4px 12px", color: overallRisk.color, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", animation: overallRisk.severity >= 4 ? "pulse 1.5s infinite" : "none" }}>⚠ {overallRisk.level} RISK</div>)}
          {lastFetch && (<div style={{ color: "#64748B", fontSize: 9 }}>Updated: {lastFetch.toLocaleTimeString()}</div>)}
          <div style={{ color: "#22D3EE", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", background: "#0F172A", padding: "4px 10px", borderRadius: 4, border: "1px solid #334155", lineHeight: 1.5, textAlign: "center" }}><div>{formatNauticalLat(latDeg, latMin, latHemi)}</div><div>{formatNauticalLon(lonDeg, lonMin, lonHemi)}</div></div>
        </div>
      </div>
      <div style={{ padding: "8px 24px 0", display: "flex", gap: 4, flexWrap: "wrap" }}>{tabBtn("dashboard", "Dashboard")}{tabBtn("vessel", "Vessel Config")}{tabBtn("weather", "Weather Sources")}{tabBtn("polar", "Polar Analysis")}{tabBtn("reference", "Reference")}</div>
      <div style={{ padding: "16px 24px" }}>
        {activeTab === "dashboard" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {panel(<>{sectionHeader("Ship's Position & Fetch")}<NauticalCoordInput label="Latitude" deg={latDeg} min={latMin} hemi={latHemi} onDegChange={setLatDeg} onMinChange={setLatMin} onHemiChange={setLatHemi} isLat={true} /><NauticalCoordInput label="Longitude" deg={lonDeg} min={lonMin} hemi={lonHemi} onDegChange={setLonDeg} onMinChange={setLonMin} onHemiChange={setLonHemi} isLat={false} /><div style={{ marginBottom: 8 }}><label style={labelStyle}>Quick Location</label><select value={locationKey} onChange={(e) => applyLocation(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>{Object.keys(LOCATIONS).map(k => <option key={k} value={k}>{k}</option>)}</select></div><button onClick={fetchData} disabled={loading} style={{ width: "100%", padding: "10px", border: "none", borderRadius: 4, background: loading ? "#334155" : "linear-gradient(90deg, #F59E0B, #D97706)", color: "#0F172A", fontWeight: 800, fontSize: 12, cursor: loading ? "wait" : "pointer", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", transition: "all 0.3s" }}>{loading ? "FETCHING DATA..." : "⟳  FETCH WEATHER DATA"}</button>{error && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 6, padding: 6, background: "#7F1D1D20", borderRadius: 4 }}>{error}</div>}</>)}
              {panel(<>{sectionHeader("Voyage Parameters")}<Field label="Ship Speed" value={speed} onChange={setSpeed} unit="kts" step={0.5} min={0} max={30} /><Field label="Ship Heading" value={heading} onChange={setHeading} unit="° True" step={1} min={0} max={359} /><div style={{ marginBottom: 8 }}><label style={labelStyle}>Vessel Preset</label><select value={preset} onChange={(e) => applyPreset(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></div></>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {panel(<>{sectionHeader("Parametric Roll Assessment")}<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><RiskGauge value={paramRatio_wave} label="Wave Param. Ratio (Tᵣ/2Tₑ)" /><RiskGauge value={paramRatio_swell} label="Swell Param. Ratio (Tᵣ/2Tₑ)" /></div><div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}><RiskGauge value={syncRatio} label="Synchronous Ratio (Tᵣ/Tₑ)" /><div style={{ textAlign: "center", padding: 10 }}><div style={{ color: "#94A3B8", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>λ / L Ratio</div><div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: waveLenRatio > 0.8 && waveLenRatio < 1.3 ? "#DC2626" : waveLenRatio > 0.6 && waveLenRatio < 1.5 ? "#D97706" : "#16A34A" }}>{waveLenRatio > 0 ? waveLenRatio.toFixed(2) : "---"}</div><div style={{ color: "#64748B", fontSize: 9, marginTop: 2 }}>{waveLenRatio > 0.8 && waveLenRatio < 1.3 ? "⚠ DANGER: λ ≈ L" : waveLenRatio > 0.6 && waveLenRatio < 1.5 ? "CAUTION" : "OK"}</div></div></div></>)}
              {panel(<>{sectionHeader("Computed Values")}<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>{statBox("Nat. Roll Tᵣ", Tr, "s", "#3B82F6")}{statBox("Enc. Tₑ Wave", Te_wave, "s", "#F59E0B")}{statBox("Enc. Tₑ Swell", Te_swell, "s", "#A855F7")}{statBox("Wave λ", waveLength, "m", "#22D3EE")}{statBox("Rel. Heading", relHeading, "°")}{statBox("Wave Speed", wavePeriod > 0 ? (G * wavePeriod / (2 * Math.PI)) : 0, "m/s", "#10B981")}</div></>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {panel(<>{sectionHeader("Directional Overview")}<div style={{ display: "flex", justifyContent: "center" }}><CompassRose waveDir={waveDir} swellDir={swellDir} shipHeading={heading} /></div></>)}
              {panel(<>{sectionHeader("Current Sea State")}<div style={{ textAlign: "center", marginBottom: 8, padding: "6px 8px", background: "#0F172A", borderRadius: 4, border: "1px solid #334155" }}><div style={{ color: "#64748B", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 3 }}>Ship's Position</div><div style={{ color: "#22D3EE", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>{formatNauticalLat(latDeg, latMin, latHemi)}</div><div style={{ color: "#22D3EE", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>{formatNauticalLon(lonDeg, lonMin, lonHemi)}</div></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>{statBox("Hs Wave", waveHeight, "m", "#3B82F6")}{statBox("Tw Wave", wavePeriod, "s", "#3B82F6")}{statBox("Hs Swell", swellHeight, "m", "#F59E0B")}{statBox("Tw Swell", swellPeriod, "s", "#F59E0B")}{currentWind && <>{statBox("Wind", currentWind.windSpeed, "km/h", "#22D3EE")}{statBox("Gusts", currentWind.windGusts, "km/h", "#EF4444")}</>}</div>{currentMarine && (<div style={{ color: "#64748B", fontSize: 9, textAlign: "center", marginTop: 8 }}>{new Date(currentMarine.time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>)}</>)}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              {panel(<>{sectionHeader("7-Day Forecast Timeline — Click to Select Hour")}{marineData ? (<><TimelineChart data={marineData} shipParams={shipParams} hourOffset={hourIdx} onHourChange={setHourIdx} /><div style={{ textAlign: "center", marginTop: 6 }}><input type="range" min={0} max={marineData.length - 1} value={hourIdx} onChange={(e) => setHourIdx(parseInt(e.target.value))} style={{ width: "90%", accentColor: "#F59E0B" }} /><div style={{ color: "#94A3B8", fontSize: 10, marginTop: 2 }}>Hour {hourIdx} — {currentMarine && new Date(currentMarine.time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div></div></>) : (<div style={{ textAlign: "center", color: "#64748B", padding: 30, fontSize: 12 }}>Fetch weather data to view the forecast timeline</div>)}</>)}
            </div>
          </div>
        )}
        {activeTab === "vessel" && (<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 800 }}>{panel(<>{sectionHeader("Hull Dimensions")}<Field label="Length Waterline (Lwl)" value={ship.Lwl} onChange={(v) => updateShip("Lwl", v)} unit="m" step={1} min={10} /><Field label="Beam (B)" value={ship.B} onChange={(v) => updateShip("B", v)} unit="m" step={0.1} min={1} /><Field label="Draft (d)" value={ship.d} onChange={(v) => updateShip("d", v)} unit="m" step={0.1} min={0.5} /><Field label="Block Coefficient (Cb)" value={ship.Cb} onChange={(v) => updateShip("Cb", v)} unit="" step={0.01} min={0.3} max={0.95} /></>)}{panel(<>{sectionHeader("Stability Parameters")}<Field label="Metacentric Height (GM)" value={ship.GM} onChange={(v) => updateShip("GM", v)} unit="m" step={0.05} min={0.01} /><div style={{ marginTop: 12, padding: 12, background: "#0F172A", borderRadius: 6, border: "1px solid #334155" }}><div style={{ color: "#F59E0B", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>COMPUTED RESULTS (IMO Method)</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{statBox("Nat. Roll Period Tᵣ", Tr, "s", "#3B82F6")}{statBox("C Factor", (0.373 + 0.023 * (ship.B / ship.d) - 0.043 * (ship.Lwl / 100)), "", "#22D3EE")}{statBox("Rad. of Gyration k", 0.39 * ship.B, "m", "#A855F7")}{statBox("B/d Ratio", ship.B / ship.d, "", "#10B981")}</div></div><div style={{ marginTop: 12, padding: 10, background: "#1a1a2e", borderRadius: 4, border: "1px solid #334155" }}><div style={{ color: "#94A3B8", fontSize: 10, lineHeight: 1.6 }}><strong style={{ color: "#F59E0B" }}>IMO Formula:</strong> Tᵣ = 2·C·B / √GM<br /><strong style={{ color: "#F59E0B" }}>C =</strong> 0.373 + 0.023·(B/d) − 0.043·(Lwl/100)<br /><strong style={{ color: "#F59E0B" }}>Source:</strong> 2008 IS Code (Res. MSC.267(85))</div></div></>)}</div>)}
        {activeTab === "weather" && (<div style={{ maxWidth: 700 }}>{panel(<>{sectionHeader("Active Weather Sources")}{Object.entries(WEATHER_SOURCES).map(([key, src]) => (<div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, marginBottom: 8, background: "#0F172A", borderRadius: 6, border: `1px solid ${activeSources.includes(key) ? "#F59E0B50" : "#334155"}` }}><div><div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 700 }}>{src.name}</div><div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>{src.desc}</div><div style={{ display: "flex", gap: 8, marginTop: 4 }}>{src.free && <span style={{ fontSize: 9, background: "#16A34A30", color: "#16A34A", padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>FREE</span>}<span style={{ fontSize: 9, background: "#3B82F630", color: "#3B82F6", padding: "2px 6px", borderRadius: 3 }}>NO API KEY</span></div></div><label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={activeSources.includes(key)} onChange={(e) => { setActiveSources(prev => e.target.checked ? [...prev, key] : prev.filter(s => s !== key)); }} style={{ accentColor: "#F59E0B", width: 18, height: 18 }} /><span style={{ color: "#94A3B8", fontSize: 11 }}>Active</span></label></div>))}</>)}{panel(<>{sectionHeader("Additional Sources (Coming Soon)")}{[{ name: "NOAA GFS Wave Model", desc: "NOAA Global Forecast System wave data (WAVEWATCH III)", status: "Planned" },{ name: "Copernicus Marine (CMEMS)", desc: "EU Copernicus Marine Environment Monitoring Service", status: "Planned" },{ name: "UK Met Office", desc: "Met Office WAVEWATCH III North Atlantic", status: "Planned" },{ name: "StormGlass.io", desc: "Multi-source aggregated marine data (free tier: 10 req/day)", status: "Planned" }].map((src, i) => (<div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, marginBottom: 8, background: "#0F172A", borderRadius: 6, border: "1px solid #334155", opacity: 0.5 }}><div><div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 700 }}>{src.name}</div><div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>{src.desc}</div></div><span style={{ fontSize: 9, background: "#64748B30", color: "#64748B", padding: "2px 8px", borderRadius: 3, fontWeight: 700 }}>{src.status}</span></div>))}</>)}</div>)}
        {activeTab === "polar" && (<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{panel(<>{sectionHeader("Parametric Roll Risk Polar")}<div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8 }}>Risk intensity by relative heading angle. Center = maximum danger (ratio = 1.0). Based on current wave period of {wavePeriod > 0 ? wavePeriod.toFixed(1) + "s" : "—"}.</div><PolarRiskDiagram shipParams={{ ...shipParams, wavePeriod: wavePeriod || 10, Tr }} /></>)}{panel(<>{sectionHeader("Speed / Heading Matrix")}<div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8 }}>Parametric ratio (Tᵣ / 2Tₑ) for various speed/heading combinations. Tw = {wavePeriod > 0 ? wavePeriod.toFixed(1) + "s" : "10s"}</div><div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}><thead><tr><th style={{ padding: "4px 6px", color: "#F59E0B", borderBottom: "1px solid #334155", textAlign: "left" }}>Spd\Hdg</th>{[0, 15, 30, 45, 60, 75, 90, 120, 150, 180].map(a => (<th key={a} style={{ padding: "4px 4px", color: "#94A3B8", borderBottom: "1px solid #334155", textAlign: "center" }}>{a}°</th>))}</tr></thead><tbody>{[4, 8, 12, 16, 20, 24].map(s => (<tr key={s}><td style={{ padding: "4px 6px", color: "#E2E8F0", fontWeight: 700, borderBottom: "1px solid #1E293B" }}>{s}kt</td>{[0, 15, 30, 45, 60, 75, 90, 120, 150, 180].map(a => { const tw = wavePeriod || 10; const te = calcEncounterPeriod(tw, s, a); const ratio = calcParametricRiskRatio(Tr, te); const risk = getRiskLevel(ratio); return (<td key={a} style={{ padding: "4px 4px", textAlign: "center", background: risk.color + "20", color: risk.color, fontWeight: risk.severity >= 3 ? 800 : 400, borderBottom: "1px solid #1E293B" }}>{ratio !== null && isFinite(ratio) ? ratio.toFixed(2) : "∞"}</td>); })}</tr>))}</tbody></table></div></>)}</div>)}
        {activeTab === "reference" && (<div style={{ maxWidth: 800 }}>{panel(<>{sectionHeader("Parametric Rolling — Theory & Formulas")}<div style={{ color: "#CBD5E1", fontSize: 12, lineHeight: 1.8 }}><p style={{ marginBottom: 12 }}><strong style={{ color: "#F59E0B" }}>Parametric rolling</strong> occurs when a vessel navigates in head or following seas where the wave encounter period is approximately <strong>half</strong> the ship's natural roll period (Tᵣ ≈ 2·Tₑ). This causes periodic variation of the righting moment (GM fluctuation between wave crest and trough), leading to progressive roll amplification.</p><div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}><div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>KEY FORMULAS</div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#E2E8F0", lineHeight: 2 }}><div><span style={{ color: "#3B82F6" }}>Natural Roll Period:</span> Tᵣ = 2·C·B / √GM</div><div><span style={{ color: "#3B82F6" }}>C Factor (IMO):</span> C = 0.373 + 0.023·(B/d) − 0.043·(Lwl/100)</div><div><span style={{ color: "#3B82F6" }}>Wave Encounter Period:</span> Tₑ = Tw / |1 − V·cos(α) / Vw|</div><div><span style={{ color: "#3B82F6" }}>Wave Speed:</span> Vw = g·Tw / (2π)</div><div><span style={{ color: "#3B82F6" }}>Wave Length:</span> λ = g·Tw² / (2π)</div><div><span style={{ color: "#3B82F6" }}>Parametric Ratio:</span> R = Tᵣ / (2·Tₑ) — DANGER when R ≈ 1.0</div><div><span style={{ color: "#3B82F6" }}>Synchronous Ratio:</span> R = Tᵣ / Tₑ — DANGER when R ≈ 1.0</div></div></div><div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}><div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>CONDITIONS FOR PARAMETRIC ROLLING</div><div style={{ fontSize: 11, lineHeight: 1.8 }}><div>1. Ship navigating in head/following seas (within ~60° of centerline)</div><div>2. Wave encounter period ≈ ½ natural roll period (Tᵣ ≈ 2Tₑ)</div><div>3. Wavelength approximately equal to ship length (λ ≈ Lwl)</div><div>4. Sufficient wave height to cause significant GM variation</div><div>5. Roll damping insufficient to counteract energy input</div><div style={{ marginTop: 6, color: "#F59E0B" }}><strong>ClassNK Criterion:</strong> (GMmax − GMmin) / (2·GM) &gt; threshold value based on damping</div></div></div><div style={{ background: "#0F172A", borderRadius: 6, padding: 16, marginBottom: 12, border: "1px solid #334155" }}><div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>RISK LEVELS</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>{[{ level: "CRITICAL", range: "|R−1| ≤ 0.1", color: "#DC2626" },{ level: "HIGH", range: "|R−1| ≤ 0.2", color: "#EA580C" },{ level: "ELEVATED", range: "|R−1| ≤ 0.3", color: "#D97706" },{ level: "MODERATE", range: "|R−1| ≤ 0.4", color: "#CA8A04" },{ level: "LOW", range: "|R−1| ≤ 0.5", color: "#16A34A" },{ level: "MINIMAL", range: "|R−1| > 0.5", color: "#0D9488" }].map(r => (<div key={r.level} style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: r.color }} /><div><div style={{ color: r.color, fontSize: 10, fontWeight: 700 }}>{r.level}</div><div style={{ color: "#64748B", fontSize: 9 }}>{r.range}</div></div></div>))}</div></div><div style={{ background: "#0F172A", borderRadius: 6, padding: 16, border: "1px solid #334155" }}><div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>PREVENTIVE ACTIONS (IMO MSC.1/Circ.1228)</div><div style={{ fontSize: 11, lineHeight: 1.8 }}><div>1. <strong style={{ color: "#E2E8F0" }}>Alter course</strong> — Change heading to modify encounter period</div><div>2. <strong style={{ color: "#E2E8F0" }}>Reduce speed</strong> — Change encounter frequency</div><div>3. <strong style={{ color: "#E2E8F0" }}>Adjust ballast</strong> — Modify GM and natural roll period</div><div>4. <strong style={{ color: "#E2E8F0" }}>Activate stabilizers</strong> — Fin stabilizers or anti-roll tanks</div><div>5. <strong style={{ color: "#E2E8F0" }}>Avoid dangerous zones</strong> — Use polar diagrams for route planning</div></div></div></div></>)}</div>)}
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}*{box-sizing:border-box}input[type="number"]::-webkit-inner-spin-button{opacity:0.5}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0F172A}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}select option{background:#0F172A;color:#E2E8F0}`}</style>
    </div>
  );
}
