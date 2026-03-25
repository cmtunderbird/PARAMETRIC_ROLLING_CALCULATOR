// ─── MeteoOverlay.jsx ──────────────────────────────────────────────────────────
// Synoptic-quality meteorological canvas overlay for Leaflet
//   Layer 1: Smooth wave-height gradient (Windy-style)
//   Layer 2: MSLP isobars every 4 hPa with labels
//   Layer 3: WMO-standard wind barbs at grid intersections
// Uses L.ImageOverlay for perfect pan/zoom sync.
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { calcRiskIntensity } from "./physics.js";

// ─── Colour scales ─────────────────────────────────────────────────────────────
const WAVE_STOPS = [
  [0,   [5,  20, 60]], [0.5, [0,  70, 130]],
  [1.0, [10, 130,160]], [1.5, [20, 175,130]],
  [2.0, [70, 195, 80]], [2.5, [160,200, 40]],
  [3.0, [215,175, 20]], [4.0, [225, 95, 20]],
  [5.0, [200, 30, 30]], [7.0, [155, 20, 90]],
  [10,  [110, 30,165]],
];
const PERIOD_STOPS = [
  [2,[0,50,120]], [5,[20,130,175]], [7,[35,175,130]],
  [9,[90,190,55]], [11,[185,190,25]], [14,[215,130,15]], [18,[175,25,65]],
];
const RISK_STOPS = [
  [0,[0,45,90]], [0.25,[10,120,145]], [0.5,[45,185,75]],
  [0.65,[185,190,25]], [0.8,[220,130,20]], [0.92,[210,55,20]], [1,[150,25,130]],
];

function lerp(stops, v) {
  if (v == null || isNaN(v)) return null;
  if (v <= stops[0][0]) return stops[0][1];
  if (v >= stops[stops.length-1][0]) return stops[stops.length-1][1];
  for (let i = 0; i < stops.length-1; i++) {
    const [v0,c0] = stops[i], [v1,c1] = stops[i+1];
    if (v >= v0 && v <= v1) {
      const t = (v-v0)/(v1-v0);
      return [Math.round(c0[0]+(c1[0]-c0[0])*t),
              Math.round(c0[1]+(c1[1]-c0[1])*t),
              Math.round(c0[2]+(c1[2]-c0[2])*t)];
    }
  }
  return stops[stops.length-1][1];
}

function bilerp(grid, rows, cols, gy, gx) {
  const x0=Math.floor(gx), x1=Math.min(x0+1,cols-1);
  const y0=Math.floor(gy), y1=Math.min(y0+1,rows-1);
  const fx=gx-x0, fy=gy-y0;
  const v=[grid[y0]?.[x0],grid[y0]?.[x1],grid[y1]?.[x0],grid[y1]?.[x1]];
  if (v.every(x=>x!=null))
    return v[0]*(1-fx)*(1-fy)+v[1]*fx*(1-fy)+v[2]*(1-fx)*fy+v[3]*fx*fy;
  const ok=v.filter(x=>x!=null);
  return ok.length ? ok.reduce((a,b)=>a+b,0)/ok.length : null;
}

// ─── Marching-squares isolines ────────────────────────────────────────────────
function isolines(grid, rows, cols, level) {
  const segs = [];
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols-1;c++) {
    const [tl,tr,bl,br] = [grid[r][c],grid[r][c+1],grid[r+1][c],grid[r+1][c+1]];
    if (tl==null||tr==null||bl==null||br==null) continue;
    const idx=(tl>=level?8:0)|(tr>=level?4:0)|(br>=level?2:0)|(bl>=level?1:0);
    if (!idx||idx===15) continue;
    const t=(a,b)=>a===b?0.5:(level-a)/(b-a);
    const T={x:c+t(tl,tr),y:r},R={x:c+1,y:r+t(tr,br)};
    const B={x:c+t(bl,br),y:r+1},Le={x:c,y:r+t(tl,bl)};
    const M={1:[[Le,B]],2:[[B,R]],3:[[Le,R]],4:[[T,R]],
      5:[[Le,T],[B,R]],6:[[T,B]],7:[[Le,T]],8:[[Le,T]],
      9:[[T,B]],10:[[Le,B],[T,R]],11:[[T,R]],12:[[Le,B]],
      13:[[B,R]],14:[[Le,B]]};
    (M[idx]||[]).forEach(s=>segs.push(s));
  }
  return segs;
}

// ─── WMO Wind Barb renderer ───────────────────────────────────────────────────
// dirFromDeg: meteorological (wind FROM direction). Staff points toward wind origin.
// Barbs on left side of staff (when looking from station toward tip).
function drawBarb(ctx, cx, cy, speedKts, dirFromDeg, sc=1) {
  const STAFF=26*sc, FULL=11*sc, HALF=6*sc, PEN=11*sc, SPC=5*sc;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dirFromDeg * Math.PI / 180);
  ctx.strokeStyle="rgba(0,0,0,0.85)";
  ctx.fillStyle="rgba(0,0,0,0.85)";
  ctx.lineWidth=1.5*sc; ctx.lineCap="round";

  if (speedKts < 2.5) {                 // calm: two circles
    ctx.beginPath(); ctx.arc(0,0,4*sc,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,7*sc,0,Math.PI*2); ctx.stroke();
    ctx.restore(); return;
  }
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-STAFF); ctx.stroke();

  let rem=speedKts, y=-STAFF;
  while (rem>=47.5) {                   // pennant (50 kt)
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(-FULL,y); ctx.lineTo(0,y+PEN);
    ctx.closePath(); ctx.fill();
    rem-=50; y+=PEN+1*sc;
  }
  while (rem>=7.5) {                    // full barb (10 kt)
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(-FULL, y-3*sc); ctx.stroke();
    rem-=10; y+=SPC;
  }
  if (rem>=2.5) {                       // half barb (5 kt)
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(-HALF, y-1.5*sc); ctx.stroke();
  }
  ctx.restore();
}

// ─── Fill null cells (NN) ────────────────────────────────────────────────────
function fillNulls(grid, rows, cols, passes=4) {
  for (let p=0;p<passes;p++) {
    let changed=false;
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      if (grid[r][c]!=null) continue;
      let s=0,n=0;
      for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
        if (!dr&&!dc) continue;
        const v=grid[r+dr]?.[c+dc];
        if (v!=null){s+=v;n++;}
      }
      if (n){grid[r][c]=s/n;changed=true;}
    }
    if (!changed) break;
  }
}

// ─── Master render ─────────────────────────────────────────────────────────────
function renderSynopticImage(marineGrid, mode, shipParams, hourIdx) {
  const { bounds, gridRes } = marineGrid;
  const { south, north, west, east } = bounds;
  const cols = Math.round((east-west)/gridRes)+1;
  const rows = Math.round((north-south)/gridRes)+1;
  const PX = 40;                        // pixels per grid cell
  const cw = cols*PX, ch = rows*PX;

  // ── Build marine value grid ──
  const mGrid = Array.from({length:rows},()=>Array(cols).fill(null));
  for (const pt of marineGrid.results) {
    if (!pt.times) continue;
    const idx = Math.min(hourIdx, pt.times.length-1);
    const c = Math.round((pt.lon-west)/gridRes);
    const r = Math.round((north-pt.lat)/gridRes);
    if (r<0||r>=rows||c<0||c>=cols) continue;
    mGrid[r][c] = mode==="waveHeight" ? pt.waveHeight?.[idx]
      : mode==="wavePeriod" ? pt.wavePeriod?.[idx]
      : calcRiskIntensity(pt.wavePeriod?.[idx], pt.waveDir?.[idx],
          shipParams?.Tr, shipParams?.speed, shipParams?.heading, shipParams?.Lwl||200);
  }
  fillNulls(mGrid, rows, cols);

  const canvas = document.createElement("canvas");
  canvas.width=cw; canvas.height=ch;
  const ctx = canvas.getContext("2d");

  // ── Layer 1: wave gradient ──
  const stops = mode==="waveHeight"?WAVE_STOPS:mode==="wavePeriod"?PERIOD_STOPS:RISK_STOPS;
  const img = ctx.createImageData(cw,ch);
  for (let py=0;py<ch;py++) {
    const gy=(py/(ch-1))*(rows-1);
    for (let px=0;px<cw;px++) {
      const gx=(px/(cw-1))*(cols-1);
      const rgb=lerp(stops,bilerp(mGrid,rows,cols,gy,gx));
      if (rgb){const i=(py*cw+px)*4;img.data[i]=rgb[0];img.data[i+1]=rgb[1];img.data[i+2]=rgb[2];img.data[i+3]=185;}
    }
  }
  ctx.putImageData(img,0,0);

  // ── Layer 2: wave isolines ──
  const isoLvl = mode==="waveHeight"?[1,2,3,4,5,7]:mode==="wavePeriod"?[4,6,8,10,12]:[0.4,0.6,0.8,0.95];
  ctx.lineWidth=0.9;
  for (const lvl of isoLvl) {
    const segs=isolines(mGrid,rows,cols,lvl);
    if (!segs.length) continue;
    ctx.strokeStyle="rgba(255,255,255,0.32)";
    ctx.beginPath();
    for (const [p0,p1] of segs){
      ctx.moveTo(p0.x/(cols-1)*cw, p0.y/(rows-1)*ch);
      ctx.lineTo(p1.x/(cols-1)*cw, p1.y/(rows-1)*ch);
    }
    ctx.stroke();
    const lbl=mode==="waveHeight"?`${lvl}m`:mode==="wavePeriod"?`${lvl}s`:`${(lvl*100).toFixed(0)}%`;
    ctx.font="500 9px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    const step=Math.max(1,Math.floor(segs.length/2));
    for (let si=Math.floor(step/3);si<segs.length;si+=step){
      const [p0,p1]=segs[si];
      const lx=((p0.x+p1.x)/2/(cols-1))*cw, ly=((p0.y+p1.y)/2/(rows-1))*ch;
      const tw=ctx.measureText(lbl).width;
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(lx-tw/2-2,ly-5.5,tw+4,11);
      ctx.fillStyle="rgba(255,255,255,0.9)"; ctx.fillText(lbl,lx,ly);
    }
  }
  return { canvas, cols, rows, cw, ch };
}


// ─── H/L Pressure Center Detection ─────────────────────────────────────────
// Scans pressure grid for local maxima (H) and minima (L) within a radius
function findPressureCenters(pGrid, mRows, mCols, gridRes, bounds, cw, ch) {
  // Adaptive radius: smaller for coarse grids, larger for fine grids
  const R = Math.max(1, Math.min(3, Math.floor(Math.min(mRows, mCols) / 6)));
  const centers = [];
  const { south, north, west, east } = bounds;
  for (let r = R; r < mRows - R; r++) {
    for (let c = R; c < mCols - R; c++) {
      const v = pGrid[r][c];
      if (v == null) continue;
      let isMax = true, isMin = true;
      for (let dr = -R; dr <= R && (isMax || isMin); dr++) {
        for (let dc = -R; dc <= R && (isMax || isMin); dc++) {
          if (!dr && !dc) continue;
          const nb = pGrid[r + dr]?.[c + dc];
          if (nb == null) continue;
          if (nb >= v) isMax = false;
          if (nb <= v) isMin = false;
        }
      }
      if (isMax || isMin) {
        const px = (c / (mCols - 1)) * cw;
        const py = (r / (mRows - 1)) * ch;
        centers.push({ type: isMax ? "H" : "L", px, py, pressure: v });
      }
    }
  }
  // Deduplicate — keep strongest within 80px
  const deduped = [];
  for (const c of centers) {
    const near = deduped.find(d => d.type === c.type && Math.hypot(d.px - c.px, d.py - c.py) < 80);
    if (near) {
      if ((c.type === "H" && c.pressure > near.pressure) ||
          (c.type === "L" && c.pressure < near.pressure)) {
        Object.assign(near, c);
      }
    } else {
      deduped.push({ ...c });
    }
  }
  return deduped;
}

// ─── Atmospheric Front Detection ────────────────────────────────────────────
// Detects fronts from wind direction convergence + pressure trough lines.
// Cold front: sharp wind veer (clockwise shift), tight isobar packing.
// Warm front: gradual wind back (counter-clockwise shift), wider spacing.
function detectFronts(pGrid, windPts, mRows, mCols, cw, ch) {
  const fronts = [];
  if (windPts.length < 8) return fronts;

  // Build a coarse wind direction grid for convergence analysis
  const cellW = cw / 12, cellH = ch / 10;
  const wGrid = Array.from({ length: 10 }, () => Array(12).fill(null));
  const sGrid = Array.from({ length: 10 }, () => Array(12).fill(null));
  for (const wp of windPts) {
    const gc = Math.floor(wp.px / cellW);
    const gr = Math.floor(wp.py / cellH);
    if (gc >= 0 && gc < 12 && gr >= 0 && gr < 10) {
      wGrid[gr][gc] = wp.wd;
      sGrid[gr][gc] = wp.ws;
    }
  }

  // Detect wind direction convergence zones (sharp direction changes)
  for (let r = 1; r < 9; r++) {
    for (let c = 1; c < 11; c++) {
      const d0 = wGrid[r][c], d1 = wGrid[r][c + 1], d2 = wGrid[r][c - 1];
      const d3 = wGrid[r - 1][c], d4 = wGrid[r + 1][c];
      if (d0 == null) continue;
      // Check horizontal wind shift
      const shifts = [];
      if (d1 != null) shifts.push(((d1 - d0 + 540) % 360) - 180);
      if (d2 != null) shifts.push(((d0 - d2 + 540) % 360) - 180);
      if (d3 != null) shifts.push(((d0 - d3 + 540) % 360) - 180);
      if (d4 != null) shifts.push(((d4 - d0 + 540) % 360) - 180);
      if (!shifts.length) continue;
      const maxShift = Math.max(...shifts.map(Math.abs));
      const avgShift = shifts.reduce((a, b) => a + b, 0) / shifts.length;
      if (maxShift > 25) {
        const px = (c + 0.5) * cellW;
        const py = (r + 0.5) * cellH;
        // Positive avg shift = veering (clockwise) = cold front
        // Negative avg shift = backing (counter-clockwise) = warm front
        const type = avgShift > 0 ? "cold" : "warm";
        fronts.push({ type, px, py, shift: maxShift, avgShift });
      }
    }
  }

  // Chain nearby front points into lines
  const chains = [];
  const used = new Set();
  for (let i = 0; i < fronts.length; i++) {
    if (used.has(i)) continue;
    const chain = [fronts[i]];
    used.add(i);
    let extended = true;
    while (extended) {
      extended = false;
      const last = chain[chain.length - 1];
      for (let j = 0; j < fronts.length; j++) {
        if (used.has(j)) continue;
        if (fronts[j].type !== chain[0].type) continue;
        const dist = Math.hypot(fronts[j].px - last.px, fronts[j].py - last.py);
        if (dist < cellW * 3.5) {
          chain.push(fronts[j]);
          used.add(j);
          extended = true;
          break;
        }
      }
    }
    if (chain.length >= 2) chains.push(chain);
  }
  return chains;
}

// ── Layer 3: Isobars + Wind Barbs ─────────────────────────────────────────────
// Renders onto the marine canvas using direct lat/lon → pixel mapping
// (independent of marine grid resolution)
function renderAtmoLayer(canvas, cols, rows, cw, ch, atmoResults, bounds, gridRes, hourIdx) {
  if (!atmoResults?.length) return;
  const ctx = canvas.getContext("2d");

  // Compute actual extent from the data + the canvas bounds
  const { south, north, west, east } = bounds;
  const latSpan = north - south || 1;
  const lonSpan = east - west || 1;

  // Direct lat/lon → pixel mapping (works regardless of grid resolution mismatch)
  const toX = (lon) => ((lon - west) / lonSpan) * cw;
  const toY = (lat) => ((north - lat) / latSpan) * ch;

  // Build sparse pressure grid for isobars (resample to marine grid)
  const mCols = Math.round(lonSpan / (gridRes || 0.25)) + 1;
  const mRows = Math.round(latSpan / (gridRes || 0.25)) + 1;
  const pGrid = Array.from({length:mRows},()=>Array(mCols).fill(null));

  // Also collect point data for wind barbs
  const windPts = [];

  for (const pt of atmoResults) {
    if (!pt.times) continue;
    const idx = Math.min(hourIdx, pt.times.length - 1);
    const c = Math.round((pt.lon - west) / (gridRes || 0.25));
    const r = Math.round((north - pt.lat) / (gridRes || 0.25));
    if (r >= 0 && r < mRows && c >= 0 && c < mCols) {
      pGrid[r][c] = pt.mslp?.[idx] ?? null;
    }
    // Collect wind data for barbs
    const ws = pt.windKts?.[idx];
    const wd = pt.windDir?.[idx];
    if (ws != null && wd != null && ws > 0) {
      windPts.push({ px: toX(pt.lon), py: toY(pt.lat), ws, wd });
    }
  }
  fillNulls(pGrid, mRows, mCols);

  // ── H/L Pressure Centers ──
  const centers = findPressureCenters(pGrid, mRows, mCols, gridRes, bounds, cw, ch);

  // ── Atmospheric Fronts ──
  const frontChains = detectFronts(pGrid, windPts, mRows, mCols, cw, ch);

  // ── Render H/L centers ──
  for (const c of centers) {
    const isH = c.type === "H";
    const color = isH ? "rgba(0,100,255,0.95)" : "rgba(220,38,38,0.95)";
    const bgColor = isH ? "rgba(0,100,255,0.15)" : "rgba(220,38,38,0.15)";
    // Filled circle background
    ctx.beginPath();
    ctx.arc(c.px, c.py, 22, 0, Math.PI * 2);
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // H or L letter
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(c.type, c.px, c.py);
    // Pressure value below
    ctx.font = "bold 9px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(c.px - 16, c.py + 24, 32, 12);
    ctx.fillStyle = color;
    ctx.fillText((c.pressure||0).toFixed(0), c.px, c.py + 30);
  }

  // ── Render Atmospheric Fronts ──
  for (const chain of frontChains) {
    const isCold = chain[0].type === "cold";
    ctx.beginPath();
    ctx.moveTo(chain[0].px, chain[0].py);
    for (let i = 1; i < chain.length; i++) {
      ctx.lineTo(chain[i].px, chain[i].py);
    }
    ctx.strokeStyle = isCold ? "rgba(0,100,255,0.85)" : "rgba(220,38,38,0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();
    // Draw symbols along the front line
    const symbolSpacing = 40;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      const dist = Math.hypot(b.px - a.px, b.py - a.py);
      const nSymbols = Math.max(1, Math.floor(dist / symbolSpacing));
      const ang = Math.atan2(b.py - a.py, b.px - a.px);
      // Perpendicular direction for triangles/semicircles (to the right of travel)
      const perpAng = ang + Math.PI / 2;
      for (let s = 0; s < nSymbols; s++) {
        const t = (s + 0.5) / nSymbols;
        const sx = a.px + (b.px - a.px) * t;
        const sy = a.py + (b.py - a.py) * t;
        if (isCold) {
          // Cold front: blue triangles pointing in direction of movement
          const sz = 8;
          const tx = sx + Math.cos(perpAng) * sz;
          const ty = sy + Math.sin(perpAng) * sz;
          const lx = sx + Math.cos(ang + Math.PI * 0.8) * sz * 0.6;
          const ly = sy + Math.sin(ang + Math.PI * 0.8) * sz * 0.6;
          const rx = sx + Math.cos(ang - Math.PI * 0.8) * sz * 0.6;
          const ry = sy + Math.sin(ang - Math.PI * 0.8) * sz * 0.6;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(lx, ly);
          ctx.lineTo(rx, ry);
          ctx.closePath();
          ctx.fillStyle = "rgba(0,100,255,0.85)";
          ctx.fill();
        } else {
          // Warm front: red semicircles pointing in direction of movement
          const sz = 7;
          ctx.beginPath();
          ctx.arc(sx, sy, sz, perpAng - Math.PI / 2, perpAng + Math.PI / 2);
          ctx.fillStyle = "rgba(220,38,38,0.85)";
          ctx.fill();
        }
      }
    }
  }

  // Isobars every 4 hPa (960–1044)
  const pLevels = [];
  for (let p=960;p<=1044;p+=4) pLevels.push(p);
  ctx.lineWidth=1.2;
  for (const lvl of pLevels) {
    const segs=isolines(pGrid,mRows,mCols,lvl);
    if (!segs.length) continue;
    const isRound50=lvl%20===0;
    ctx.strokeStyle=isRound50?"rgba(255,220,50,0.75)":"rgba(255,255,255,0.35)";
    ctx.lineWidth=isRound50?1.8:0.9;
    ctx.setLineDash(isRound50?[]:[4,3]);
    ctx.beginPath();
    for (const [p0,p1] of segs){
      ctx.moveTo(p0.x/(mCols-1)*cw, p0.y/(mRows-1)*ch);
      ctx.lineTo(p1.x/(mCols-1)*cw, p1.y/(mRows-1)*ch);
    }
    ctx.stroke();
    if (isRound50 && segs.length>0) {
      ctx.setLineDash([]);
      ctx.font="bold 10px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      const [p0,p1]=segs[Math.floor(segs.length/2)];
      const lx=((p0.x+p1.x)/2/(mCols-1))*cw, ly=((p0.y+p1.y)/2/(mRows-1))*ch;
      ctx.fillStyle="rgba(0,0,0,0.6)"; ctx.fillRect(lx-13,ly-6,26,12);
      ctx.fillStyle="rgba(255,220,50,0.95)"; ctx.fillText(`${lvl}`,lx,ly);
    }
  }
  ctx.setLineDash([]);

  // WMO wind barbs — thin out if too dense
  const minSpacing = 35; // minimum pixel spacing between barbs
  const drawn = [];
  const sc = Math.max(0.7, Math.min(1.2, cw / 800));
  for (const wp of windPts) {
    // Skip if too close to an already-drawn barb
    if (drawn.some(d => Math.hypot(d.px - wp.px, d.py - wp.py) < minSpacing)) continue;
    drawBarb(ctx, wp.px, wp.py, wp.ws, wp.wd, sc);
    drawn.push(wp);
  }
}

// ── Layer 4: Ocean current arrows ──────────────────────────────────────────────
// Direct lat/lon → pixel mapping (independent of grid resolution)
function renderCurrentsLayer(canvas, cols, rows, cw, ch, physResults, bounds, gridRes, hourIdx) {
  if (!physResults?.length) return;
  const { south, north, west, east } = bounds;
  const ctx = canvas.getContext("2d");
  const latSpan = north - south || 1;
  const lonSpan = east - west || 1;
  const toX = (lon) => ((lon - west) / lonSpan) * cw;
  const toY = (lat) => ((north - lat) / latSpan) * ch;

  const minSpacing = 30;
  const drawn = [];
  ctx.strokeStyle = "rgba(34,211,238,0.70)";
  ctx.fillStyle   = "rgba(34,211,238,0.70)";
  ctx.lineWidth   = 1.5;

  for (const pt of physResults) {
    if (!pt.times) continue;
    const idx = Math.min(hourIdx, pt.times.length - 1);
    const spd = pt.currentSpeed?.[idx];
    const dir = pt.currentDir?.[idx];
    if (spd == null || dir == null || spd < 0.05) continue;
    const px = toX(pt.lon);
    const py = toY(pt.lat);
    if (px < 0 || px > cw || py < 0 || py > ch) continue;
    if (drawn.some(d => Math.hypot(d.px - px, d.py - py) < minSpacing)) continue;
    const len = Math.min(spd * 60, 28);
    const ang = (dir - 90) * Math.PI / 180;
    const ex = px + len * Math.cos(ang), ey = py + len * Math.sin(ang);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    const ha = 0.45, hl = 7;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(ang - ha), ey - hl * Math.sin(ang - ha));
    ctx.lineTo(ex - hl * Math.cos(ang + ha), ey - hl * Math.sin(ang + ha));
    ctx.closePath(); ctx.fill();
    drawn.push({ px, py });
  }
}
export default function MeteoCanvasOverlay({ marineGrid, atmoGrid, physicsGrid, mode, shipParams, hourIdx=0 }) {
  const map = useMap();
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!map || !marineGrid?.results?.length) return;
    const { south, north, west, east } = marineGrid.bounds;
    const { canvas, cols, rows, cw, ch } = renderSynopticImage(marineGrid, mode, shipParams, hourIdx);
    // All layers map onto the MARINE canvas — use marineGrid.bounds for pixel coords
    const canvasBounds = marineGrid.bounds;
    if (atmoGrid?.results?.length) {
      const aRes = atmoGrid.gridRes || marineGrid.gridRes;
      renderAtmoLayer(canvas, 0, 0, cw, ch, atmoGrid.results, canvasBounds, aRes, hourIdx);
    }
    if (physicsGrid?.results?.length) {
      const pRes = physicsGrid.gridRes || marineGrid.gridRes;
      renderCurrentsLayer(canvas, 0, 0, cw, ch, physicsGrid.results, canvasBounds, pRes, hourIdx);
    }

    const bounds = L.latLngBounds([[south,west],[north,east]]);
    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current=null; }
    const ov = L.imageOverlay(canvas.toDataURL("image/png"), bounds, { opacity:0.88, interactive:false, zIndex:250 });
    ov.addTo(map);
    overlayRef.current = ov;
    return () => { if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current=null; } };
  }, [map, marineGrid, atmoGrid, physicsGrid, mode, shipParams, hourIdx]);

  useEffect(()=>()=>{ if(overlayRef.current){overlayRef.current.remove();overlayRef.current=null;} },[]);
  return null;
}

// ─── Legend export ─────────────────────────────────────────────────────────────
export function getColorLegend(mode) {
  if (mode==="waveHeight") return { title:"Sig. Wave Height (m)", items:[
    {label:"0.5",color:"rgb(0,70,130)"},{label:"1m",color:"rgb(10,130,160)"},
    {label:"2m",color:"rgb(70,195,80)"},{label:"3m",color:"rgb(215,175,20)"},
    {label:"5m",color:"rgb(200,30,30)"},{label:"7m+",color:"rgb(155,20,90)"}]};
  if (mode==="wavePeriod") return { title:"Wave Period (s)", items:[
    {label:"4s",color:"rgb(20,130,175)"},{label:"7s",color:"rgb(35,175,130)"},
    {label:"9s",color:"rgb(90,190,55)"},{label:"11s",color:"rgb(185,190,25)"},
    {label:"14s+",color:"rgb(215,130,15)"}]};
  return { title:"Parametric Roll Risk", items:[
    {label:"Min",color:"rgb(0,45,90)"},{label:"Low",color:"rgb(45,185,75)"},
    {label:"Mod",color:"rgb(185,190,25)"},{label:"High",color:"rgb(210,55,20)"},
    {label:"Crit",color:"rgb(150,25,130)"}]};
}
