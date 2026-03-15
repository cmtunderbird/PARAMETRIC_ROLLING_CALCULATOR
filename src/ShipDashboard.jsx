// ─── ShipDashboard.jsx ─────────────────────────────────────────────────────────
// Live ship position + synoptic polar thermal diagram
//
// Components exported:
//   ShipPositionLayer    – Leaflet overlay: ship icon, heading vector, COG vector
//   ShipPolarDiagram     – SVG thermal polar chart: risk heatmap + all env vectors
//   calcCurrentPosition  – Interpolates position along route from BOSP + now
//   ShipInfoPanel        – Compact data panel (pos, heading, weather at position)
import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { G, DEG_TO_RAD, calcEncounterPeriod, calcParametricRollRisk,
         calcWaveLength, calcMotions, getMotionStatus } from "./physics.js";

// ─── Haversine bearing ────────────────────────────────────────────────────────
function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const φ1 = lat1 * DEG_TO_RAD, φ2 = lat2 * DEG_TO_RAD;
  const x = Math.sin(dLon) * Math.cos(φ2);
  const y = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

// ─── Interpolate current position along route ─────────────────────────────────
export function calcCurrentPosition(voyageWPs) {
  if (!voyageWPs?.length) return null;
  const nowMs = Date.now();
  const bospMs = voyageWPs[0].etaMs;
  const eospMs = voyageWPs[voyageWPs.length - 1].etaMs;
  if (nowMs < bospMs) return { status: "pre-departure", etaBosp: bospMs };
  if (nowMs > eospMs) return { status: "arrived", lat: voyageWPs[voyageWPs.length-1].lat,
    lon: voyageWPs[voyageWPs.length-1].lon, heading: 0, cog: 0 };

  for (let i = 1; i < voyageWPs.length; i++) {
    const a = voyageWPs[i - 1], b = voyageWPs[i];
    if (nowMs >= a.etaMs && nowMs <= b.etaMs) {
      const frac = (nowMs - a.etaMs) / (b.etaMs - a.etaMs);
      const lat  = a.lat + (b.lat - a.lat) * frac;
      const lon  = a.lon + (b.lon - a.lon) * frac;
      const hdg  = bearingTo(a.lat, a.lon, b.lat, b.lon);
      const elapsed_h = (nowMs - bospMs) / 3600000;
      const cumNM = (a.cumNM || 0) + ((b.cumNM || 0) - (a.cumNM || 0)) * frac;
      return { status:"underway", lat, lon, heading: hdg, cog: hdg,
               cumNM, elapsed_h, legIdx: i - 1, frac,
               nextWP: b, nextWP_eta: b.etaMs, nmToNext: (b.cumNM - cumNM) };
    }
  }
  return null;
}

// ─── Ship SVG icon ─────────────────────────────────────────────────────────────
function shipSVG(heading, statusColor = "#22D3EE") {
  const rot = heading - 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
    <g transform="rotate(${rot},22,22)">
      <!-- ship hull -->
      <path d="M22 4 L30 18 L28 38 L22 40 L16 38 L14 18 Z"
        fill="${statusColor}" fill-opacity="0.90" stroke="#fff" stroke-width="1.5"/>
      <!-- bow marker -->
      <polygon points="22,4 19,12 25,12" fill="#fff" opacity="0.8"/>
      <!-- heading tick -->
      <line x1="22" y1="2" x2="22" y2="14" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    </g>
    <!-- pulse ring -->
    <circle cx="22" cy="22" r="20" fill="none" stroke="${statusColor}" stroke-width="1.2" opacity="0.4"/>
  </svg>`;
}

// ─── Leaflet overlay: ship marker + heading + COG vectors ────────────────────
export function ShipPositionLayer({ pos, weather }) {
  const map = useMap();
  const refs = useRef({ marker: null, hvec: null, cvec: null, wvec: null, svec: null, wndvec: null });

  useEffect(() => {
    if (!map || !pos || pos.status !== "underway") return;
    const { lat, lon, heading, cog } = pos;
    const R = refs.current;

    // ── Ship icon ──
    const icon = L.divIcon({
      className: "", iconSize: [44, 44], iconAnchor: [22, 22],
      html: shipSVG(heading, pos.status === "underway" ? "#22D3EE" : "#64748B"),
    });
    if (R.marker) map.removeLayer(R.marker);
    R.marker = L.marker([lat, lon], { icon, zIndexOffset: 1000 })
      .bindPopup(buildPopupHtml(pos, weather))
      .addTo(map);

    // Vector helper: draw an arrow from [lat,lon] toward bearing, length in NM
    function arrow(bearing_deg, lengthNM, color, dash = "") {
      const φ = bearing_deg * DEG_TO_RAD;
      const dlat = Math.cos(φ) * lengthNM / 60;
      const dlon = Math.sin(φ) * lengthNM / (60 * Math.cos(lat * DEG_TO_RAD));
      const tip = [lat + dlat, lon + dlon];
      return L.polyline([[lat, lon], tip], {
        color, weight: 3, opacity: 0.9,
        dashArray: dash || null,
      }).addTo(map);
    }

    const nm = 18; // vector length NM
    if (R.hvec) map.removeLayer(R.hvec);
    if (R.cvec) map.removeLayer(R.cvec);
    if (R.wvec) map.removeLayer(R.wvec);
    if (R.svec) map.removeLayer(R.svec);
    if (R.wndvec) map.removeLayer(R.wndvec);

    // Heading vector — solid cyan
    R.hvec = arrow(heading, nm, "#22D3EE");
    // COG vector — dashed blue (same as heading without current data)
    R.cvec = arrow(cog, nm * 0.85, "#3B82F6", "8,5");

    if (weather) {
      // Wave direction (FROM) — red
      if (weather.waveDir != null) R.wvec = arrow(weather.waveDir, nm * 0.7, "#EF4444");
      // Swell direction (FROM) — amber
      if (weather.swellDir != null) R.svec = arrow(weather.swellDir, nm * 0.6, "#F59E0B");
      // Wind direction (FROM) — white
      if (weather.windDir != null) R.wndvec = arrow(weather.windDir, nm * 0.65, "#E2E8F0", "4,4");
    }

    return () => {
      [R.marker, R.hvec, R.cvec, R.wvec, R.svec, R.wndvec].forEach(l => { if (l) map.removeLayer(l); });
    };
  }, [map, pos, weather]);

  return null;
}

function buildPopupHtml(pos, wx) {
  const fmt = v => v != null ? v.toFixed(1) : "—";
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;min-width:190px">
    <div style="font-weight:800;color:#22D3EE;margin-bottom:6px;font-size:13px">⛵ SHIP POSITION</div>
    <div>Lat: <b>${pos.lat.toFixed(4)}°</b> Lon: <b>${pos.lon.toFixed(4)}°</b></div>
    <div>Hdg: <b>${pos.heading.toFixed(0)}°T</b> &nbsp;|&nbsp; COG: <b>${pos.cog.toFixed(0)}°T</b></div>
    <div>Dist from BOSP: <b>${pos.cumNM.toFixed(1)} NM</b></div>
    <div>Elapsed: <b>${pos.elapsed_h.toFixed(1)} h</b></div>
    ${wx ? `<hr style="border-color:#334155;margin:6px 0"/>
    <div>Hs: <b>${fmt(wx.waveHeight)}m</b> &nbsp; Tw: <b>${fmt(wx.wavePeriod)}s</b></div>
    <div>Swell: <b>${fmt(wx.swellHeight)}m / ${fmt(wx.swellPeriod)}s</b></div>
    <div>Wind: <b>${wx.windKts?.toFixed(0)||"—"} kts</b> from <b>${wx.windDir?.toFixed(0)||"—"}°T</b></div>
    <div>MSLP: <b>${wx.mslp?.toFixed(0)||"—"} hPa</b></div>` : ""}
  </div>`;
}

// ─── Thermal colour scale for polar risk diagram ──────────────────────────────
function riskThermal(v) {   // v: 0–1
  // Deep blue (safe) → cyan → green → yellow → orange → red (critical)
  const stops = [
    [0,    [5,  20, 80]],
    [0.15, [0,  100,180]],
    [0.30, [20, 180,140]],
    [0.45, [80, 200, 60]],
    [0.60, [200,195, 20]],
    [0.75, [230,120, 15]],
    [0.88, [220, 45, 20]],
    [1.0,  [180, 15,130]],
  ];
  if (v <= 0) return stops[0][1];
  if (v >= 1) return stops[stops.length-1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0,c0] = stops[i], [v1,c1] = stops[i+1];
    if (v >= v0 && v <= v1) {
      const t = (v - v0) / (v1 - v0);
      return [Math.round(c0[0]+(c1[0]-c0[0])*t),
              Math.round(c0[1]+(c1[1]-c0[1])*t),
              Math.round(c0[2]+(c1[2]-c0[2])*t)];
    }
  }
  return stops[stops.length-1][1];
}

const SPEEDS = [8, 10, 12, 14, 16, 18];     // speed rings (kts)
const HDGS   = Array.from({length:72}, (_,i) => i * 5);  // 0..355 step 5°

// ─── ShipPolarDiagram ──────────────────────────────────────────────────────────
// SVG thermal polar chart showing parametric roll risk across all headings × speeds
// + overlaid directional vectors for wave, swell, wind, heading, COG
export function ShipPolarDiagram({ pos, weather, shipParams }) {
  const SIZE   = 420;
  const CX     = SIZE / 2, CY = SIZE / 2;
  const MAX_R  = 178;
  const RINGS  = SPEEDS.map((_, i) => ({
    inner: 20 + i * 28,
    outer: 20 + (i + 1) * 28,
    speed: SPEEDS[i],
  }));

  const Tr       = shipParams?.Tr   || 14;
  const Lwl      = shipParams?.Lwl  || 200;
  const waveLen  = weather ? calcWaveLength(weather.wavePeriod || 8) : 100;
  const waveDir  = weather?.waveDir  ?? 0;
  const swellDir = weather?.swellDir ?? 0;
  const windDir  = weather?.windDir  ?? 0;
  const hdg      = pos?.heading ?? 0;
  const cog      = pos?.cog     ?? hdg;

  // ── Build wedge sectors ──
  const sectors = [];
  for (const { inner, outer, speed } of RINGS) {
    for (const absHdg of HDGS) {
      const relAngle = ((waveDir - absHdg) + 360) % 360;
      const Te   = calcEncounterPeriod(weather?.wavePeriod || 8, speed, relAngle);
      const risk = calcParametricRollRisk(waveLen, Te, Tr, relAngle, Lwl);
      const [r,g,b] = riskThermal(risk);
      // SVG arc path for this wedge
      const startDeg = absHdg - 2.5;
      const endDeg   = absHdg + 2.5;
      const s1 = startDeg * DEG_TO_RAD - Math.PI/2;
      const e1 = endDeg   * DEG_TO_RAD - Math.PI/2;
      const x1i = CX + inner * Math.cos(s1), y1i = CY + inner * Math.sin(s1);
      const x1o = CX + outer * Math.cos(s1), y1o = CY + outer * Math.sin(s1);
      const x2i = CX + inner * Math.cos(e1), y2i = CY + inner * Math.sin(e1);
      const x2o = CX + outer * Math.cos(e1), y2o = CY + outer * Math.sin(e1);
      sectors.push(
        <path key={`${speed}-${absHdg}`}
          d={`M${x1i},${y1i} L${x1o},${y1o} A${outer},${outer} 0 0,1 ${x2o},${y2o} L${x2i},${y2i} A${inner},${inner} 0 0,0 ${x1i},${y1i} Z`}
          fill={`rgb(${r},${g},${b})`} stroke="none" opacity="0.88" />
      );
    }
  }

  // ── Helper: draw arrow from centre toward bearing at radius ──
  function vecPt(bearing_deg, radius) {
    const a = bearing_deg * DEG_TO_RAD - Math.PI / 2;
    return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
  }
  function Arrow({ bearing, len, color, dash, label, width=2.5 }) {
    const tip  = vecPt(bearing, len);
    const back = vecPt(bearing + 180, 8);
    const la   = vecPt(bearing + 150, len - 12);
    const ra   = vecPt(bearing - 150, len - 12);
    return (
      <g>
        <line x1={CX} y1={CY} x2={tip.x} y2={tip.y}
          stroke={color} strokeWidth={width} strokeDasharray={dash||"none"} strokeLinecap="round" opacity="0.92"/>
        <polygon points={`${tip.x},${tip.y} ${la.x},${la.y} ${ra.x},${ra.y}`}
          fill={color} opacity="0.92"/>
        {label && <text x={vecPt(bearing, len + 14).x} y={vecPt(bearing, len + 14).y}
          textAnchor="middle" dominantBaseline="middle"
          style={{fontSize:9,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",fill:color}}>{label}</text>}
      </g>
    );
  }

  // Current ship heading dot: find which ring speed is closest to shipParams.speed
  const curSpeed = shipParams?.speed || 15;
  const ringIdx  = SPEEDS.reduce((best,s,i) => Math.abs(s-curSpeed) < Math.abs(SPEEDS[best]-curSpeed) ? i : best, 0);
  const curR     = (RINGS[ringIdx].inner + RINGS[ringIdx].outer) / 2;
  const curPt    = vecPt(hdg, curR);

  // ── Compass ring labels ──
  const compassDirs = [
    {deg:0,lbl:"N"},{deg:45,lbl:"NE"},{deg:90,lbl:"E"},{deg:135,lbl:"SE"},
    {deg:180,lbl:"S"},{deg:225,lbl:"SW"},{deg:270,lbl:"W"},{deg:315,lbl:"NW"},
  ];

  // ── Danger arc: where Tr ≈ 2Te (overlay red arc segments) ──
  const dangerArcs = [];
  for (const { inner, outer, speed } of RINGS) {
    const arcPts = [];
    for (let a = 0; a < 360; a += 2) {
      const relAngle = ((waveDir - a) + 360) % 360;
      const Te = calcEncounterPeriod(weather?.wavePeriod || 8, speed, relAngle);
      const ratio = Te > 0 ? Tr / (2 * Te) : 0;
      if (Math.abs(ratio - 1) < 0.08) {
        const ang = a * DEG_TO_RAD - Math.PI / 2;
        const r = (inner + outer) / 2;
        arcPts.push(`${CX + r * Math.cos(ang)},${CY + r * Math.sin(ang)}`);
      }
    }
    if (arcPts.length > 3) {
      dangerArcs.push(
        <polyline key={`danger-${speed}`}
          points={arcPts.join(" ")} fill="none"
          stroke="#FF0040" strokeWidth="3" strokeLinecap="round" opacity="0.75"/>
      );
    }
  }

  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <svg width={SIZE} height={SIZE} style={{display:"block",background:"#060D1A",borderRadius:8,border:"1px solid #334155"}}>

        {/* ── Thermal wedge sectors ── */}
        {sectors}

        {/* ── Danger resonance arcs ── */}
        {dangerArcs}

        {/* ── Speed ring labels ── */}
        {RINGS.map(({outer,speed}) => {
          const p = vecPt(12, outer);
          return <text key={speed} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
            style={{fontSize:8,fill:"rgba(255,255,255,0.5)",fontFamily:"'JetBrains Mono',monospace"}}>{speed}kt</text>;
        })}

        {/* ── Compass graticule ── */}
        {[0,30,60,90,120,150,180,210,240,270,300,330].map(d => {
          const p = vecPt(d, MAX_R + 10);
          return <line key={d} x1={CX} y1={CY}
            x2={CX + (MAX_R) * Math.cos(d*DEG_TO_RAD - Math.PI/2)}
            y2={CY + (MAX_R) * Math.sin(d*DEG_TO_RAD - Math.PI/2)}
            stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>;
        })}
        {compassDirs.map(({deg,lbl}) => {
          const p = vecPt(deg, MAX_R + 14);
          return <text key={lbl} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
            style={{fontSize: lbl==="N"?12:9, fontWeight:lbl==="N"?900:500,
              fill: lbl==="N"?"#F59E0B":"rgba(255,255,255,0.6)",
              fontFamily:"'JetBrains Mono',monospace"}}>{lbl}</text>;
        })}

        {/* ── Outer ring ── */}
        <circle cx={CX} cy={CY} r={MAX_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>

        {/* ── Environmental vectors ── */}
        {weather?.waveDir  != null && <Arrow bearing={waveDir}  len={MAX_R-10} color="#EF4444" width={2.5} label="WAV"/>}
        {weather?.swellDir != null && <Arrow bearing={swellDir} len={MAX_R-22} color="#F59E0B" width={2}   label="SWL" dash="6,3"/>}
        {weather?.windDir  != null && <Arrow bearing={windDir}  len={MAX_R-16} color="#E2E8F0" width={1.8} label="WND" dash="3,3"/>}

        {/* ── Ship heading + COG vectors ── */}
        <Arrow bearing={cog} len={MAX_R-4} color="#3B82F6" width={2} dash="9,5" label="COG"/>
        <Arrow bearing={hdg} len={MAX_R-4} color="#22D3EE" width={3}            label="HDG"/>

        {/* ── Current ship state dot ── */}
        <circle cx={curPt.x} cy={curPt.y} r={7} fill="#22D3EE" stroke="#fff" strokeWidth="1.5" opacity="0.95"/>
        <text x={curPt.x} y={curPt.y} textAnchor="middle" dominantBaseline="middle"
          style={{fontSize:6,fontWeight:900,fill:"#0F172A",fontFamily:"'JetBrains Mono',monospace"}}>▲</text>

        {/* ── Centre ── */}
        <circle cx={CX} cy={CY} r={18} fill="#0F172A" stroke="#334155" strokeWidth="1.2"/>
        <text x={CX} y={CY-4}   textAnchor="middle" style={{fontSize:7,fill:"#94A3B8",fontFamily:"'JetBrains Mono',monospace"}}>PARAM</text>
        <text x={CX} y={CY+5}   textAnchor="middle" style={{fontSize:7,fill:"#94A3B8",fontFamily:"'JetBrains Mono',monospace"}}>RISK</text>
      </svg>

      {/* ── Thermal legend bar ── */}
      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6}}>
        <span style={{color:"#64748B",fontSize:9,fontFamily:"'JetBrains Mono',monospace"}}>MIN</span>
        <div style={{flex:1,height:8,borderRadius:4,background:
          "linear-gradient(to right,rgb(5,20,80),rgb(0,100,180),rgb(20,180,140),rgb(80,200,60),rgb(200,195,20),rgb(230,120,15),rgb(220,45,20),rgb(180,15,130))"}}/>
        <span style={{color:"#64748B",fontSize:9,fontFamily:"'JetBrains Mono',monospace"}}>CRIT</span>
      </div>

      {/* ── Vector legend ── */}
      <div style={{marginTop:6,display:"flex",gap:12,flexWrap:"wrap"}}>
        {[
          {color:"#22D3EE",dash:"",label:"HDG (Ship Heading)"},
          {color:"#3B82F6",dash:"9,5",label:"COG (Course Over Ground)"},
          {color:"#EF4444",dash:"",label:"WAV (Wave direction FROM)"},
          {color:"#F59E0B",dash:"6,3",label:"SWL (Swell direction FROM)"},
          {color:"#E2E8F0",dash:"3,3",label:"WND (Wind direction FROM)"},
          {color:"#FF0040",dash:"",label:"─── Resonance (Tr≈2Te)"},
        ].map(({color,label})=>(
          <div key={label} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:16,height:3,background:color,borderRadius:2}}/>
            <span style={{color:"#64748B",fontSize:8,fontFamily:"'JetBrains Mono',monospace"}}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ShipInfoPanel ─────────────────────────────────────────────────────────────
// Compact status panel showing live position, heading, environmental data
export function ShipInfoPanel({ pos, weather, shipParams, motions, motionStatus }) {
  const stat  = (label, val, unit, color="#E2E8F0") => (
    <div style={{textAlign:"center",padding:"5px 4px",background:"#0F172A",borderRadius:4}}>
      <div style={{color,fontSize:15,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>
        {typeof val === "number" && isFinite(val) ? val.toFixed(val > 99 ? 0 : 1) : (val ?? "—")}
        {unit && <span style={{fontSize:9,color:"#64748B",marginLeft:2}}>{unit}</span>}
      </div>
      <div style={{color:"#64748B",fontSize:8,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:2}}>{label}</div>
    </div>
  );

  if (!pos || pos.status !== "underway") {
    const msg = !pos ? "Calculate voyage ETAs first"
      : pos.status === "pre-departure" ? `BOSP in ${((pos.etaBosp - Date.now())/3600000).toFixed(1)} h`
      : "Voyage complete — EOSP passed";
    return (
      <div style={{padding:16,textAlign:"center",color:"#64748B",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
        <div style={{fontSize:20,marginBottom:6}}>⚓</div>{msg}
      </div>
    );
  }

  const w = weather;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {/* Status banner */}
      <div style={{padding:"6px 10px",borderRadius:4,background: motionStatus?.color+"18" || "#22D3EE18",
        border:`1px solid ${motionStatus?.color||"#22D3EE"}50`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"#22D3EE",fontWeight:800,fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>⛵ UNDERWAY</span>
        <span style={{color:motionStatus?.color||"#16A34A",fontWeight:800,fontSize:11}}>{motionStatus?.label||"SAFE"}</span>
      </div>

      {/* Position */}
      <div style={{padding:"6px 8px",background:"#0F172A",borderRadius:4,border:"1px solid #334155",
        fontFamily:"'JetBrains Mono',monospace",fontSize:10,lineHeight:1.8}}>
        <span style={{color:"#64748B"}}>LAT</span> <b style={{color:"#22D3EE"}}>{Math.abs(pos.lat).toFixed(4)}° {pos.lat>=0?"N":"S"}</b>
        &nbsp;&nbsp;
        <span style={{color:"#64748B"}}>LON</span> <b style={{color:"#22D3EE"}}>{Math.abs(pos.lon).toFixed(4)}° {pos.lon>=0?"E":"W"}</b>
      </div>

      {/* Nav grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
        {stat("HDG",pos.heading,"°T","#22D3EE")}
        {stat("COG",pos.cog,"°T","#3B82F6")}
        {stat("Elapsed",pos.elapsed_h,"h","#94A3B8")}
        {stat("BOSP dist",pos.cumNM,"NM","#F59E0B")}
        {stat("To next WP",pos.nmToNext,"NM","#A855F7")}
      </div>

      {/* Weather at position */}
      {w && <>
        <div style={{color:"#F59E0B",fontSize:9,fontWeight:700,letterSpacing:"0.15em",
          borderTop:"1px solid #1E293B",paddingTop:6,textTransform:"uppercase"}}>Sea State at Position</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
          {stat("Hs Wave",w.waveHeight,"m","#3B82F6")}
          {stat("Tw Wave",w.wavePeriod,"s","#3B82F6")}
          {stat("Wave dir",w.waveDir,"°T","#64748B")}
          {stat("Hs Swell",w.swellHeight,"m","#F59E0B")}
          {stat("Tw Swell",w.swellPeriod,"s","#F59E0B")}
          {stat("Swell dir",w.swellDir,"°T","#64748B")}
          {stat("Wind",w.windKts,"kts","#22D3EE")}
          {stat("Wind dir",w.windDir,"°T","#64748B")}
          {stat("MSLP",w.mslp,"hPa","#A855F7")}
        </div>
      </>}

      {/* Seakeeping at position */}
      {motions && <>
        <div style={{color:"#F59E0B",fontSize:9,fontWeight:700,letterSpacing:"0.15em",
          borderTop:"1px solid #1E293B",paddingTop:6,textTransform:"uppercase"}}>Seakeeping at Position</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
          {stat("Roll",motions.roll,"°", motions.roll>=25?"#DC2626":motions.roll>=15?"#D97706":"#22D3EE")}
          {stat("Pitch",motions.pitch,"°", motions.pitch>=8?"#DC2626":motions.pitch>=5?"#D97706":"#22D3EE")}
          {stat("Bridge",motions.bridgeAcc,"m/s²", motions.bridgeAcc>=2.94?"#DC2626":motions.bridgeAcc>=1.96?"#D97706":"#16A34A")}
          {stat("Slam",motions.slam*100,"%", motions.slam>=0.1?"#EA580C":motions.slam>=0.03?"#D97706":"#16A34A")}
          {stat("GreenWtr",motions.greenWater*100,"%", motions.greenWater>=0.1?"#EA580C":"#16A34A")}
          {stat("P.Risk",(motions.paramRisk*100).toFixed(0),"%", motions.paramRisk>=0.7?"#DC2626":motions.paramRisk>=0.4?"#D97706":"#16A34A")}
        </div>
      </>}
    </div>
  );
}
