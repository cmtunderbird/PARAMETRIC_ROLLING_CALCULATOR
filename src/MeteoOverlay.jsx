// ─── MeteoOverlay.jsx ─────────────────────────────────────────────────────────
// Professional meteorological chart overlay with:
//   • Smooth bilinear-interpolated thermal gradient (offscreen canvas)
//   • Isolines via marching squares contouring algorithm
//   • Synoptic-style labeling and wave direction arrows
//   • Uses Leaflet L.ImageOverlay for perfect pan/zoom sync
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// ─── Color Scales (meteorological standard) ──────────────────────────────────
const WAVE_HEIGHT_STOPS = [
  [0.0, [10, 80, 80]], [0.5, [13, 148, 136]], [1.0, [22, 163, 74]],
  [2.0, [34, 211, 238]], [3.0, [59, 130, 246]], [4.0, [168, 85, 247]],
  [5.5, [234, 88, 12]], [7.0, [220, 38, 38]], [10.0, [159, 18, 57]],
];
const WAVE_PERIOD_STOPS = [
  [2.0, [34, 211, 238]], [4.0, [59, 130, 246]], [6.0, [22, 163, 74]],
  [8.0, [202, 138, 4]], [10.0, [217, 119, 6]], [13.0, [234, 88, 12]],
  [18.0, [220, 38, 38]],
];
const RISK_STOPS = [
  [0.0, [13, 148, 136]], [0.3, [22, 163, 74]], [0.5, [202, 138, 4]],
  [0.7, [217, 119, 6]], [0.85, [234, 88, 12]], [1.0, [220, 38, 38]],
];

function lerpColor(stops, value) {
  if (value == null || isNaN(value)) return [40, 40, 60];
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
function bilinearInterpolate(grid, rows, cols, y, x) {
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, cols - 1);
  const y0 = Math.floor(y), y1 = Math.min(y0 + 1, rows - 1);
  const fx = x - x0, fy = y - y0;
  const v00 = grid[y0]?.[x0], v10 = grid[y0]?.[x1];
  const v01 = grid[y1]?.[x0], v11 = grid[y1]?.[x1];
  if (v00 == null || v10 == null || v01 == null || v11 == null) return null;
  return v00*(1-fx)*(1-fy) + v10*fx*(1-fy) + v01*(1-fx)*fy + v11*fx*fy;
}

// ─── Marching Squares Isoline Extraction ─────────────────────────────────────
function extractIsolines(grid, rows, cols, level) {
  const segments = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = grid[r]?.[c], tr = grid[r]?.[c+1], bl = grid[r+1]?.[c], br = grid[r+1]?.[c+1];
      if (tl == null || tr == null || bl == null || br == null) continue;
      const idx = (tl>=level?8:0)|(tr>=level?4:0)|(br>=level?2:0)|(bl>=level?1:0);
      if (idx === 0 || idx === 15) continue;
      const t = (v1,v2) => v1===v2 ? 0.5 : (level-v1)/(v2-v1);
      const top={x:c+t(tl,tr),y:r}, right={x:c+1,y:r+t(tr,br)};
      const bottom={x:c+t(bl,br),y:r+1}, left={x:c,y:r+t(tl,bl)};
      const cases = {1:[[left,bottom]],2:[[bottom,right]],3:[[left,right]],4:[[top,right]],
        5:[[left,top],[bottom,right]],6:[[top,bottom]],7:[[left,top]],8:[[left,top]],
        9:[[top,bottom]],10:[[left,bottom],[top,right]],11:[[top,right]],12:[[left,bottom]],
        13:[[bottom,right]],14:[[left,bottom]]};
      (cases[idx]||[]).forEach(seg => segments.push(seg));
    }
  }
  return segments;
}

// ─── Parametric risk at a point ──────────────────────────────────────────────
function calcRiskIntensity(wavePeriod, waveDir, shipTr, shipSpeed, shipHeading) {
  if (!wavePeriod || !shipTr || shipTr <= 0) return 0;
  const V = (shipSpeed || 15) * 0.51444;
  const relHdg = waveDir != null ? ((waveDir - (shipHeading || 0) + 360) % 360) : 0;
  const waveSpd = (9.81 * wavePeriod) / (2 * Math.PI);
  const denom = 1 - (V * Math.cos(relHdg * Math.PI / 180)) / waveSpd;
  if (Math.abs(denom) < 0.01) return 0;
  const Te = wavePeriod / Math.abs(denom);
  const ratio = shipTr / (2 * Te);
  return Math.max(0, 1 - Math.abs(ratio - 1));
}

// ─── Render meteo to offscreen canvas → returns data URL ─────────────────────
function renderMeteoImage(gridData, mode, shipParams) {
  const { south, north, west, east } = gridData.bounds;
  const res = gridData.gridRes;
  const cols = Math.round((east - west) / res) + 1;
  const rows = Math.round((north - south) / res) + 1;

  // Build 2D grids
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const dirGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const pt of gridData.results) {
    if (!pt.weather) continue;
    const c = Math.round((pt.lon - west) / res);
    const r = Math.round((north - pt.lat) / res);
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      if (mode === "waveHeight") grid[r][c] = pt.weather.waveHeight;
      else if (mode === "wavePeriod") grid[r][c] = pt.weather.wavePeriod;
      else grid[r][c] = calcRiskIntensity(pt.weather.wavePeriod, pt.weather.waveDir, shipParams?.Tr, shipParams?.speed, shipParams?.heading);
      dirGrid[r][c] = pt.weather.waveDir;
    }
  }

  let stops, isoLevels;
  if (mode === "waveHeight") { stops = WAVE_HEIGHT_STOPS; isoLevels = [0.5,1,1.5,2,3,4,5,7]; }
  else if (mode === "wavePeriod") { stops = WAVE_PERIOD_STOPS; isoLevels = [4,6,8,10,12,15]; }
  else { stops = RISK_STOPS; isoLevels = [0.2,0.4,0.6,0.8,0.95]; }

  // Render resolution: ~4 pixels per grid cell for smooth interpolation
  const pxPerCell = 4;
  const cw = Math.max(cols * pxPerCell, 100);
  const ch = Math.max(rows * pxPerCell, 100);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");

  // ── Gradient fill ──
  const imgData = ctx.createImageData(cw, ch);
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const gridY = (py / (ch - 1)) * (rows - 1);
      const gridX = (px / (cw - 1)) * (cols - 1);
      const val = bilinearInterpolate(grid, rows, cols, gridY, gridX);
      const [r, g, b] = lerpColor(stops, val);
      const idx = (py * cw + px) * 4;
      imgData.data[idx] = r; imgData.data[idx+1] = g;
      imgData.data[idx+2] = b; imgData.data[idx+3] = val != null ? 150 : 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // ── Isolines ──
  ctx.lineWidth = 1.8;
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const level of isoLevels) {
    const segments = extractIsolines(grid, rows, cols, level);
    if (segments.length === 0) continue;
    const [lr,lg,lb] = lerpColor(stops, level);
    const lineColor = `rgb(${Math.min(255,lr+70)},${Math.min(255,lg+70)},${Math.min(255,lb+70)})`;
    ctx.strokeStyle = lineColor;
    ctx.beginPath();
    for (const [p0, p1] of segments) {
      ctx.moveTo((p0.x/(cols-1))*cw, (p0.y/(rows-1))*ch);
      ctx.lineTo((p1.x/(cols-1))*cw, (p1.y/(rows-1))*ch);
    }
    ctx.stroke();
    // Labels
    const labelText = mode==="waveHeight" ? `${level}m` : mode==="wavePeriod" ? `${level}s` : `${(level*100).toFixed(0)}%`;
    const labelInterval = Math.max(1, Math.floor(segments.length / 4));
    for (let si = 0; si < segments.length; si += labelInterval) {
      const [p0,p1] = segments[si];
      const lx = (((p0.x+p1.x)/2)/(cols-1))*cw;
      const ly = (((p0.y+p1.y)/2)/(rows-1))*ch;
      const tm = ctx.measureText(labelText);
      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.fillRect(lx-tm.width/2-3, ly-7, tm.width+6, 14);
      ctx.fillStyle = lineColor;
      ctx.fillText(labelText, lx, ly);
    }
  }

  // ── Wave direction arrows ──
  ctx.strokeStyle = "rgba(226,232,240,0.6)";
  ctx.fillStyle = "rgba(226,232,240,0.6)";
  ctx.lineWidth = 1.2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dir = dirGrid[r]?.[c];
      if (dir == null) continue;
      const px = (c / Math.max(1, cols-1)) * cw;
      const py = (r / Math.max(1, rows-1)) * ch;
      const rad = (dir - 90) * Math.PI / 180;
      const len = Math.min(cw, ch) / (Math.max(rows, cols) * 0.7);
      const ex = px + len*Math.cos(rad), ey = py + len*Math.sin(rad);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      const ax1=ex+4*Math.cos(rad+2.6), ay1=ey+4*Math.sin(rad+2.6);
      const ax2=ex+4*Math.cos(rad-2.6), ay2=ey+4*Math.sin(rad-2.6);
      ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ax1,ay1); ctx.lineTo(ax2,ay2); ctx.closePath(); ctx.fill();
    }
  }

  return canvas.toDataURL("image/png");
}

// ═══════════════════════════════════════════════════════════════════════════════
// React Component: uses L.ImageOverlay for native Leaflet pan/zoom sync
// ═══════════════════════════════════════════════════════════════════════════════
export default function MeteoCanvasOverlay({ gridData, mode, shipParams }) {
  const map = useMap();
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!map || !gridData || !gridData.results.length) return;

    const { south, north, west, east } = gridData.bounds;
    const bounds = L.latLngBounds([[south, west], [north, east]]);

    // Render gradient + isolines to offscreen canvas → data URL
    const dataUrl = renderMeteoImage(gridData, mode, shipParams);

    // Remove previous overlay
    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }

    // Create native Leaflet ImageOverlay — handles pan/zoom perfectly
    const overlay = L.imageOverlay(dataUrl, bounds, {
      opacity: 0.85,
      interactive: false,
      zIndex: 250,   // above base tiles, below markers/polylines
    });
    overlay.addTo(map);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [map, gridData, mode, shipParams]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (overlayRef.current) {
        overlayRef.current.remove();
        overlayRef.current = null;
      }
    };
  }, []);

  return null;
}

// ─── Legend data for control panel ────────────────────────────────────────────
export function getColorLegend(mode) {
  if (mode === "waveHeight") {
    return { title: "Sig. Wave Height (m)", items: [
      {label:"< 0.5",color:"rgb(10,80,80)"},{label:"0.5",color:"rgb(13,148,136)"},
      {label:"1.0",color:"rgb(22,163,74)"},{label:"2.0",color:"rgb(34,211,238)"},
      {label:"3.0",color:"rgb(59,130,246)"},{label:"4.0",color:"rgb(168,85,247)"},
      {label:"5.5",color:"rgb(234,88,12)"},{label:"7+",color:"rgb(220,38,38)"},
    ]};
  } else if (mode === "wavePeriod") {
    return { title: "Wave Period (s)", items: [
      {label:"< 4",color:"rgb(34,211,238)"},{label:"4-6",color:"rgb(59,130,246)"},
      {label:"6-8",color:"rgb(22,163,74)"},{label:"8-10",color:"rgb(202,138,4)"},
      {label:"10-13",color:"rgb(217,119,6)"},{label:"13+",color:"rgb(234,88,12)"},
    ]};
  } else {
    return { title: "Parametric Roll Risk", items: [
      {label:"MIN",color:"rgb(13,148,136)"},{label:"LOW",color:"rgb(22,163,74)"},
      {label:"MOD",color:"rgb(202,138,4)"},{label:"ELV",color:"rgb(217,119,6)"},
      {label:"HIGH",color:"rgb(234,88,12)"},{label:"CRIT",color:"rgb(220,38,38)"},
    ]};
  }
}
