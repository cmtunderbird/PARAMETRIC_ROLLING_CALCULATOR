// ─── MeteoOverlay.jsx ─────────────────────────────────────────────────────────
// Clean meteorological overlay inspired by Windy.com:
//   • High-resolution smooth gradient (40px per grid cell)
//   • Subtle thin isolines with very sparse labels
//   • No arrows or clutter — just clean thermal gradient
//   • L.ImageOverlay for perfect Leaflet pan/zoom sync
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// ─── Color Scales — smooth meteorological palettes ───────────────────────────
const WAVE_HEIGHT_STOPS = [
  [0.0, [0, 40, 70]],      // deep navy — calm
  [0.3, [0, 70, 120]],     // dark blue
  [0.6, [10, 120, 160]],   // steel blue
  [1.0, [20, 170, 140]],   // teal
  [1.5, [60, 190, 90]],    // green
  [2.0, [140, 200, 50]],   // yellow-green
  [2.5, [200, 190, 30]],   // yellow
  [3.0, [220, 160, 20]],   // amber
  [3.5, [230, 120, 15]],   // orange
  [4.0, [220, 70, 20]],    // dark orange
  [5.0, [200, 30, 30]],    // red
  [6.0, [170, 20, 60]],    // crimson
  [7.0, [150, 30, 120]],   // magenta
  [9.0, [130, 40, 170]],   // purple
  [12.0, [100, 50, 180]],  // deep purple
];

const WAVE_PERIOD_STOPS = [
  [2.0, [0, 50, 100]],
  [4.0, [20, 120, 180]],
  [6.0, [30, 170, 140]],
  [8.0, [80, 190, 60]],
  [10.0, [180, 190, 30]],
  [12.0, [220, 140, 20]],
  [14.0, [210, 70, 25]],
  [18.0, [170, 25, 70]],
];

const RISK_STOPS = [
  [0.0, [0, 50, 90]],
  [0.2, [10, 120, 140]],
  [0.4, [40, 180, 80]],
  [0.6, [180, 190, 30]],
  [0.75, [220, 140, 20]],
  [0.85, [210, 60, 20]],
  [0.95, [180, 25, 50]],
  [1.0, [140, 30, 140]],
];

function lerpColor(stops, value) {
  if (value == null || isNaN(value)) return null;
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i], [v1, c1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// ─── Bilinear Interpolation ──────────────────────────────────────────────────
function bilerp(grid, rows, cols, y, x) {
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, cols - 1);
  const y0 = Math.floor(y), y1 = Math.min(y0 + 1, rows - 1);
  const fx = x - x0, fy = y - y0;
  const v00 = grid[y0]?.[x0], v10 = grid[y0]?.[x1];
  const v01 = grid[y1]?.[x0], v11 = grid[y1]?.[x1];
  if (v00 == null || v10 == null || v01 == null || v11 == null) return null;
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

// ─── Marching Squares Isoline Extraction ─────────────────────────────────────
function extractIsolines(grid, rows, cols, level) {
  const segs = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = grid[r][c], tr = grid[r][c + 1];
      const bl = grid[r + 1][c], br = grid[r + 1][c + 1];
      if (tl == null || tr == null || bl == null || br == null) continue;
      const idx = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (!idx || idx === 15) continue;
      const t = (a, b) => (a === b ? 0.5 : (level - a) / (b - a));
      const T = { x: c + t(tl, tr), y: r };
      const R = { x: c + 1, y: r + t(tr, br) };
      const B = { x: c + t(bl, br), y: r + 1 };
      const Le = { x: c, y: r + t(tl, bl) };
      const C = {
        1: [[Le, B]], 2: [[B, R]], 3: [[Le, R]], 4: [[T, R]],
        5: [[Le, T], [B, R]], 6: [[T, B]], 7: [[Le, T]],
        8: [[Le, T]], 9: [[T, B]], 10: [[Le, B], [T, R]],
        11: [[T, R]], 12: [[Le, B]], 13: [[B, R]], 14: [[Le, B]],
      };
      (C[idx] || []).forEach(s => segs.push(s));
    }
  }
  return segs;
}

// ─── Risk calculation ────────────────────────────────────────────────────────
function calcRiskIntensity(Tw, wDir, Tr, spd, hdg) {
  if (!Tw || !Tr || Tr <= 0) return 0;
  const V = (spd || 15) * 0.51444;
  const rel = wDir != null ? ((wDir - (hdg || 0) + 360) % 360) : 0;
  const ws = (9.81 * Tw) / (2 * Math.PI);
  const den = 1 - (V * Math.cos(rel * Math.PI / 180)) / ws;
  if (Math.abs(den) < 0.01) return 0;
  return Math.max(0, 1 - Math.abs(Tr / (2 * Tw / Math.abs(den)) - 1));
}

// ─── Render high-res meteo image ─────────────────────────────────────────────
function renderMeteoImage(gridData, mode, shipParams) {
  const { south, north, west, east } = gridData.bounds;
  const res = gridData.gridRes;
  const cols = Math.round((east - west) / res) + 1;
  const rows = Math.round((north - south) / res) + 1;

  // Build 2D value grid
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const pt of gridData.results) {
    if (!pt.weather) continue;
    const c = Math.round((pt.lon - west) / res);
    const r = Math.round((north - pt.lat) / res);
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      grid[r][c] = mode === "waveHeight" ? pt.weather.waveHeight
        : mode === "wavePeriod" ? pt.weather.wavePeriod
        : calcRiskIntensity(pt.weather.wavePeriod, pt.weather.waveDir,
            shipParams?.Tr, shipParams?.speed, shipParams?.heading);
    }
  }

  let stops, isoLevels;
  if (mode === "waveHeight") {
    stops = WAVE_HEIGHT_STOPS;
    isoLevels = [1, 2, 3, 4, 5, 7];
  } else if (mode === "wavePeriod") {
    stops = WAVE_PERIOD_STOPS;
    isoLevels = [4, 6, 8, 10, 12];
  } else {
    stops = RISK_STOPS;
    isoLevels = [0.4, 0.6, 0.8, 0.95];
  }

  // High-res canvas: 40px per grid cell for Windy-quality smooth gradient
  const pxPerCell = 40;
  const cw = Math.max(cols * pxPerCell, 400);
  const ch = Math.max(rows * pxPerCell, 400);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");

  // ── Smooth gradient fill (full coverage) ──
  const imgData = ctx.createImageData(cw, ch);
  for (let py = 0; py < ch; py++) {
    const gy = (py / (ch - 1)) * (rows - 1);
    for (let px = 0; px < cw; px++) {
      const gx = (px / (cw - 1)) * (cols - 1);
      const val = bilerp(grid, rows, cols, gy, gx);
      const rgb = lerpColor(stops, val);
      if (rgb) {
        const i = (py * cw + px) * 4;
        imgData.data[i] = rgb[0];
        imgData.data[i + 1] = rgb[1];
        imgData.data[i + 2] = rgb[2];
        imgData.data[i + 3] = 180; // rich but translucent
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // ── Subtle isolines — thin, semi-transparent ──
  ctx.lineWidth = 0.8;
  for (const level of isoLevels) {
    const segs = extractIsolines(grid, rows, cols, level);
    if (!segs.length) continue;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    for (const [p0, p1] of segs) {
      ctx.moveTo((p0.x / (cols - 1)) * cw, (p0.y / (rows - 1)) * ch);
      ctx.lineTo((p1.x / (cols - 1)) * cw, (p1.y / (rows - 1)) * ch);
    }
    ctx.stroke();

    // Very sparse labels — max 2 per level, small font
    const lbl = mode === "waveHeight" ? `${level}m`
      : mode === "wavePeriod" ? `${level}s`
      : `${(level * 100).toFixed(0)}%`;
    ctx.font = "500 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const step = Math.max(1, Math.floor(segs.length / 2));
    for (let si = Math.floor(step / 3); si < segs.length; si += step) {
      const [p0, p1] = segs[si];
      const lx = ((p0.x + p1.x) / 2 / (cols - 1)) * cw;
      const ly = ((p0.y + p1.y) / 2 / (rows - 1)) * ch;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(lx - tw / 2 - 2, ly - 5.5, tw + 4, 11);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(lbl, lx, ly);
    }
  }

  return canvas.toDataURL("image/png");
}

// ═══ React Component — L.ImageOverlay ════════════════════════════════════════
export default function MeteoCanvasOverlay({ gridData, mode, shipParams }) {
  const map = useMap();
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!map || !gridData || !gridData.results.length) return;
    const { south, north, west, east } = gridData.bounds;
    const bounds = L.latLngBounds([[south, west], [north, east]]);
    const dataUrl = renderMeteoImage(gridData, mode, shipParams);

    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }
    const overlay = L.imageOverlay(dataUrl, bounds, {
      opacity: 0.9, interactive: false, zIndex: 250,
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

  useEffect(() => () => {
    if (overlayRef.current) { overlayRef.current.remove(); overlayRef.current = null; }
  }, []);

  return null;
}

// ─── Legend ───────────────────────────────────────────────────────────────────
export function getColorLegend(mode) {
  if (mode === "waveHeight") return { title: "Sig. Wave Height (m)", items: [
    { label: "0.5", color: "rgb(0,70,120)" },
    { label: "1", color: "rgb(20,170,140)" },
    { label: "2", color: "rgb(140,200,50)" },
    { label: "3", color: "rgb(220,160,20)" },
    { label: "4", color: "rgb(220,70,20)" },
    { label: "5", color: "rgb(200,30,30)" },
    { label: "7+", color: "rgb(150,30,120)" },
  ]};
  if (mode === "wavePeriod") return { title: "Wave Period (s)", items: [
    { label: "4", color: "rgb(20,120,180)" },
    { label: "6", color: "rgb(30,170,140)" },
    { label: "8", color: "rgb(80,190,60)" },
    { label: "10", color: "rgb(180,190,30)" },
    { label: "12", color: "rgb(220,140,20)" },
    { label: "14+", color: "rgb(210,70,25)" },
  ]};
  return { title: "Parametric Roll Risk", items: [
    { label: "MIN", color: "rgb(0,50,90)" },
    { label: "LOW", color: "rgb(40,180,80)" },
    { label: "MOD", color: "rgb(180,190,30)" },
    { label: "ELV", color: "rgb(220,140,20)" },
    { label: "HIGH", color: "rgb(210,60,20)" },
    { label: "CRIT", color: "rgb(140,30,140)" },
  ]};
}
