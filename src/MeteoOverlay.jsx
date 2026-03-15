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
  ctx.strokeStyle="rgba(255,255,255,0.92)";
  ctx.fillStyle="rgba(255,255,255,0.92)";
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
function renderSynopticImage(marineGrid, atmoGrid, mode, shipParams, hourIdx) {
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

// ── Layer 3: Isobars + Wind Barbs ─────────────────────────────────────────────
function renderAtmoLayer(canvas, cols, rows, cw, ch, atmoResults, bounds, gridRes, hourIdx) {
  if (!atmoResults?.length) return;
  const { south, north, west, east } = bounds;
  const ctx = canvas.getContext("2d");

  // Build grids
  const pGrid = Array.from({length:rows},()=>Array(cols).fill(null));
  const wSpd  = Array.from({length:rows},()=>Array(cols).fill(null));
  const wDir  = Array.from({length:rows},()=>Array(cols).fill(null));

  for (const pt of atmoResults) {
    if (!pt.times) continue;
    const idx = Math.min(hourIdx, pt.times.length-1);
    const c = Math.round((pt.lon-west)/gridRes);
    const r = Math.round((north-pt.lat)/gridRes);
    if (r<0||r>=rows||c<0||c>=cols) continue;
    pGrid[r][c] = pt.mslp?.[idx]  ?? null;
    wSpd[r][c]  = pt.windKts?.[idx] ?? null;
    wDir[r][c]  = pt.windDir?.[idx] ?? null;
  }
  fillNulls(pGrid,rows,cols);

  // Isobars every 4 hPa (960–1044)
  const pLevels = [];
  for (let p=960;p<=1044;p+=4) pLevels.push(p);
  ctx.lineWidth=1.2;
  for (const lvl of pLevels) {
    const segs=isolines(pGrid,rows,cols,lvl);
    if (!segs.length) continue;
    const isRound50=lvl%20===0;
    ctx.strokeStyle=isRound50?"rgba(255,220,50,0.75)":"rgba(255,255,255,0.35)";
    ctx.lineWidth=isRound50?1.8:0.9;
    ctx.setLineDash(isRound50?[]:[4,3]);
    ctx.beginPath();
    for (const [p0,p1] of segs){
      ctx.moveTo(p0.x/(cols-1)*cw, p0.y/(rows-1)*ch);
      ctx.lineTo(p1.x/(cols-1)*cw, p1.y/(rows-1)*ch);
    }
    ctx.stroke();
    // Label 1020 and every 20 hPa
    if (isRound50 && segs.length>0) {
      ctx.setLineDash([]);
      ctx.font="bold 10px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      const [p0,p1]=segs[Math.floor(segs.length/2)];
      const lx=((p0.x+p1.x)/2/(cols-1))*cw, ly=((p0.y+p1.y)/2/(rows-1))*ch;
      ctx.fillStyle="rgba(0,0,0,0.6)"; ctx.fillRect(lx-13,ly-6,26,12);
      ctx.fillStyle="rgba(255,220,50,0.95)"; ctx.fillText(`${lvl}`,lx,ly);
    }
  }
  ctx.setLineDash([]);

  // WMO wind barbs — every other grid point to avoid clutter
  const step = cols > 12 ? 2 : 1;
  for (let r=0;r<rows;r+=step) {
    for (let c=0;c<cols;c+=step) {
      const spd = wSpd[r][c], dir = wDir[r][c];
      if (spd==null||dir==null) continue;
      const px = (c/(cols-1))*cw;
      const py = (r/(rows-1))*ch;
      const sc = Math.max(0.7, Math.min(1.2, cw/(cols*40)));
      drawBarb(ctx, px, py, spd, dir, sc);
    }
  }
}

// ─── React component ─────────────────────────────────────────────────────────
export default function MeteoCanvasOverlay({ marineGrid, atmoGrid, mode, shipParams, hourIdx=0 }) {
  const map = useMap();
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!map || !marineGrid?.results?.length) return;
    const { south, north, west, east } = marineGrid.bounds;
    const { canvas, cols, rows, cw, ch } = renderSynopticImage(marineGrid, atmoGrid, mode, shipParams, hourIdx);
    if (atmoGrid?.results?.length)
      renderAtmoLayer(canvas, cols, rows, cw, ch, atmoGrid.results, marineGrid.bounds, marineGrid.gridRes, hourIdx);

    const bounds = L.latLngBounds([[south,west],[north,east]]);
    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current=null; }
    const ov = L.imageOverlay(canvas.toDataURL("image/png"), bounds, { opacity:0.88, interactive:false, zIndex:250 });
    ov.addTo(map);
    overlayRef.current = ov;
    return () => { if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current=null; } };
  }, [map, marineGrid, atmoGrid, mode, shipParams, hourIdx]);

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
