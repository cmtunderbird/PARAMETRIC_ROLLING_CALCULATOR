// ─── MeteoOverlay.jsx ─────────────────────────────────────────────────────────
// Professional meteorological chart overlay with:
//   • High-resolution bilinear-interpolated thermal gradient
//   • Clean isolines via marching squares with sparse labeling
//   • Subtle wave direction arrows
//   • Uses Leaflet L.ImageOverlay for perfect pan/zoom sync
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// ─── Color Scales ────────────────────────────────────────────────────────────
const WAVE_HEIGHT_STOPS = [
  [0.0, [10, 50, 60]], [0.5, [13, 148, 136]], [1.0, [22, 163, 74]],
  [2.0, [34, 180, 210]], [3.0, [59, 130, 246]], [4.0, [140, 70, 220]],
  [5.5, [210, 80, 20]], [7.0, [200, 35, 35]], [10.0, [140, 15, 50]],
];
const WAVE_PERIOD_STOPS = [
  [2.0, [34, 190, 220]], [4.0, [59, 130, 246]], [6.0, [22, 163, 74]],
  [8.0, [180, 130, 10]], [10.0, [200, 110, 10]], [13.0, [210, 75, 15]],
  [18.0, [190, 35, 35]],
];
const RISK_STOPS = [
  [0.0, [13, 130, 120]], [0.3, [22, 150, 74]], [0.5, [180, 125, 10]],
  [0.7, [200, 105, 10]], [0.85, [210, 75, 15]], [1.0, [195, 35, 35]],
];

function lerpColor(stops, value) {
  if (value == null || isNaN(value)) return null;
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i], [v1, c1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0);
      return [Math.round(c0[0]+(c1[0]-c0[0])*t), Math.round(c0[1]+(c1[1]-c0[1])*t), Math.round(c0[2]+(c1[2]-c0[2])*t)];
    }
  }
  return stops[stops.length - 1][1];
}

// ─── Bilinear Interpolation ──────────────────────────────────────────────────
function bilerp(grid, rows, cols, y, x) {
  const x0 = Math.floor(x), x1 = Math.min(x0+1, cols-1);
  const y0 = Math.floor(y), y1 = Math.min(y0+1, rows-1);
  const fx = x-x0, fy = y-y0;
  const v00=grid[y0]?.[x0], v10=grid[y0]?.[x1], v01=grid[y1]?.[x0], v11=grid[y1]?.[x1];
  if (v00==null||v10==null||v01==null||v11==null) return null;
  return v00*(1-fx)*(1-fy)+v10*fx*(1-fy)+v01*(1-fx)*fy+v11*fx*fy;
}

// ─── Marching Squares ────────────────────────────────────────────────────────
function extractIsolines(grid, rows, cols, level) {
  const segs = [];
  for (let r=0;r<rows-1;r++) for (let c=0;c<cols-1;c++) {
    const tl=grid[r][c],tr=grid[r][c+1],bl=grid[r+1][c],br=grid[r+1][c+1];
    if (tl==null||tr==null||bl==null||br==null) continue;
    const idx=(tl>=level?8:0)|(tr>=level?4:0)|(br>=level?2:0)|(bl>=level?1:0);
    if (!idx||idx===15) continue;
    const t=(a,b)=>a===b?0.5:(level-a)/(b-a);
    const T={x:c+t(tl,tr),y:r},R={x:c+1,y:r+t(tr,br)},B={x:c+t(bl,br),y:r+1},Le={x:c,y:r+t(tl,bl)};
    const C={1:[[Le,B]],2:[[B,R]],3:[[Le,R]],4:[[T,R]],5:[[Le,T],[B,R]],6:[[T,B]],7:[[Le,T]],
      8:[[Le,T]],9:[[T,B]],10:[[Le,B],[T,R]],11:[[T,R]],12:[[Le,B]],13:[[B,R]],14:[[Le,B]]};
    (C[idx]||[]).forEach(s=>segs.push(s));
  }
  return segs;
}

// ─── Risk intensity ──────────────────────────────────────────────────────────
function calcRiskIntensity(Tw, wDir, Tr, spd, hdg) {
  if (!Tw||!Tr||Tr<=0) return 0;
  const V=(spd||15)*0.51444, rel=wDir!=null?((wDir-(hdg||0)+360)%360):0;
  const ws=(9.81*Tw)/(2*Math.PI), den=1-(V*Math.cos(rel*Math.PI/180))/ws;
  if (Math.abs(den)<0.01) return 0;
  return Math.max(0, 1-Math.abs(Tr/(2*Tw/Math.abs(den))-1));
}

// ─── Render to offscreen canvas ──────────────────────────────────────────────
function renderMeteoImage(gridData, mode, shipParams) {
  const {south,north,west,east}=gridData.bounds, res=gridData.gridRes;
  const cols=Math.round((east-west)/res)+1, rows=Math.round((north-south)/res)+1;

  // Build grids
  const grid=Array.from({length:rows},()=>Array(cols).fill(null));
  const dirGrid=Array.from({length:rows},()=>Array(cols).fill(null));
  for (const pt of gridData.results) {
    if (!pt.weather) continue;
    const c=Math.round((pt.lon-west)/res), r=Math.round((north-pt.lat)/res);
    if (r>=0&&r<rows&&c>=0&&c<cols) {
      grid[r][c] = mode==="waveHeight" ? pt.weather.waveHeight
        : mode==="wavePeriod" ? pt.weather.wavePeriod
        : calcRiskIntensity(pt.weather.wavePeriod, pt.weather.waveDir, shipParams?.Tr, shipParams?.speed, shipParams?.heading);
      dirGrid[r][c] = pt.weather.waveDir;
    }
  }

  let stops, isoLevels;
  if (mode==="waveHeight") { stops=WAVE_HEIGHT_STOPS; isoLevels=[1,2,3,4,5,7]; }
  else if (mode==="wavePeriod") { stops=WAVE_PERIOD_STOPS; isoLevels=[4,6,8,10,13]; }
  else { stops=RISK_STOPS; isoLevels=[0.3,0.5,0.7,0.85]; }

  // High-res render: 12px per grid cell for smooth gradient
  const pxPerCell = 12;
  const cw = Math.max(cols*pxPerCell, 200);
  const ch = Math.max(rows*pxPerCell, 200);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");

  // ── Smooth gradient fill ──
  const imgData = ctx.createImageData(cw, ch);
  for (let py=0; py<ch; py++) {
    for (let px=0; px<cw; px++) {
      const gy=(py/(ch-1))*(rows-1), gx=(px/(cw-1))*(cols-1);
      const val = bilerp(grid, rows, cols, gy, gx);
      const rgb = lerpColor(stops, val);
      if (rgb) {
        const i=(py*cw+px)*4;
        imgData.data[i]=rgb[0]; imgData.data[i+1]=rgb[1];
        imgData.data[i+2]=rgb[2]; imgData.data[i+3]=120;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // ── Clean isolines with sparse labels ──
  ctx.lineWidth = 1.2;
  ctx.font = "600 10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const level of isoLevels) {
    const segs = extractIsolines(grid, rows, cols, level);
    if (!segs.length) continue;
    const [lr,lg,lb] = lerpColor(stops, level) || [200,200,200];
    const lc = `rgba(${Math.min(255,lr+80)},${Math.min(255,lg+80)},${Math.min(255,lb+80)},0.85)`;
    ctx.strokeStyle = lc;
    ctx.beginPath();
    for (const [p0,p1] of segs) {
      ctx.moveTo((p0.x/(cols-1))*cw, (p0.y/(rows-1))*ch);
      ctx.lineTo((p1.x/(cols-1))*cw, (p1.y/(rows-1))*ch);
    }
    ctx.stroke();
    // Sparse labels: max 3 per isoline level
    const lbl = mode==="waveHeight"?`${level}m`:mode==="wavePeriod"?`${level}s`:`${(level*100).toFixed(0)}%`;
    const step = Math.max(1, Math.floor(segs.length/3));
    for (let si=Math.floor(step/2); si<segs.length; si+=step) {
      const [p0,p1]=segs[si];
      const lx=((p0.x+p1.x)/2/(cols-1))*cw, ly=((p0.y+p1.y)/2/(rows-1))*ch;
      const tw=ctx.measureText(lbl).width;
      ctx.fillStyle="rgba(11,17,32,0.75)";
      ctx.fillRect(lx-tw/2-2, ly-6, tw+4, 12);
      ctx.fillStyle=lc;
      ctx.fillText(lbl, lx, ly);
    }
  }

  // ── Subtle wave direction arrows (every other grid point) ──
  ctx.strokeStyle = "rgba(200,210,230,0.4)";
  ctx.fillStyle = "rgba(200,210,230,0.4)";
  ctx.lineWidth = 0.8;
  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      if ((r+c)%2!==0) continue; // skip every other for cleaner look
      const dir = dirGrid[r]?.[c];
      if (dir==null) continue;
      const px=(c/Math.max(1,cols-1))*cw, py=(r/Math.max(1,rows-1))*ch;
      const rad=(dir-90)*Math.PI/180;
      const len=Math.min(cw,ch)/(Math.max(rows,cols)*1.2);
      const ex=px+len*Math.cos(rad), ey=py+len*Math.sin(rad);
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(ex,ey); ctx.stroke();
      const a1=ex+3*Math.cos(rad+2.5), b1=ey+3*Math.sin(rad+2.5);
      const a2=ex+3*Math.cos(rad-2.5), b2=ey+3*Math.sin(rad-2.5);
      ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(a1,b1); ctx.lineTo(a2,b2); ctx.closePath(); ctx.fill();
    }
  }
  return canvas.toDataURL("image/png");
}

// ═══ React Component: L.ImageOverlay for native pan/zoom ═══════════════════
export default function MeteoCanvasOverlay({ gridData, mode, shipParams }) {
  const map = useMap();
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!map||!gridData||!gridData.results.length) return;
    const {south,north,west,east}=gridData.bounds;
    const bounds=L.latLngBounds([[south,west],[north,east]]);
    const dataUrl=renderMeteoImage(gridData, mode, shipParams);

    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current=null; }

    const overlay=L.imageOverlay(dataUrl, bounds, { opacity:0.85, interactive:false, zIndex:250 });
    overlay.addTo(map);
    overlayRef.current=overlay;

    return ()=>{ if(overlayRef.current){map.removeLayer(overlayRef.current);overlayRef.current=null;} };
  }, [map, gridData, mode, shipParams]);

  useEffect(()=>()=>{ if(overlayRef.current){overlayRef.current.remove();overlayRef.current=null;} },[]);
  return null;
}

// ─── Legend data ──────────────────────────────────────────────────────────────
export function getColorLegend(mode) {
  if (mode==="waveHeight") return {title:"Sig. Wave Height (m)",items:[
    {label:"<0.5",color:"rgb(10,50,60)"},{label:"0.5",color:"rgb(13,148,136)"},
    {label:"1",color:"rgb(22,163,74)"},{label:"2",color:"rgb(34,180,210)"},
    {label:"3",color:"rgb(59,130,246)"},{label:"4",color:"rgb(140,70,220)"},
    {label:"5.5",color:"rgb(210,80,20)"},{label:"7+",color:"rgb(200,35,35)"},
  ]};
  if (mode==="wavePeriod") return {title:"Wave Period (s)",items:[
    {label:"<4",color:"rgb(34,190,220)"},{label:"4-6",color:"rgb(59,130,246)"},
    {label:"6-8",color:"rgb(22,163,74)"},{label:"8-10",color:"rgb(180,130,10)"},
    {label:"10-13",color:"rgb(200,110,10)"},{label:"13+",color:"rgb(210,75,15)"},
  ]};
  return {title:"Parametric Roll Risk",items:[
    {label:"MIN",color:"rgb(13,130,120)"},{label:"LOW",color:"rgb(22,150,74)"},
    {label:"MOD",color:"rgb(180,125,10)"},{label:"ELV",color:"rgb(200,105,10)"},
    {label:"HIGH",color:"rgb(210,75,15)"},{label:"CRIT",color:"rgb(195,35,35)"},
  ]};
}
