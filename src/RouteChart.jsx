import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { autoDetectAndParse, computeRouteStats, generateWeatherSamplePoints, generateSampleRTZ, haversineNM, bearing } from "./RouteParser.js";
import MeteoCanvasOverlay, { getColorLegend } from "./MeteoOverlay.jsx";

// ─── Leaflet icon fix (webpack/vite strips default icons) ─────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const wpIcon = (color, label) => L.divIcon({
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;font-family:'JetBrains Mono',monospace;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${label}</div>`,
});

const riskColor = (severity) => ["#0D9488","#16A34A","#CA8A04","#D97706","#EA580C","#DC2626"][severity] || "#64748B";

// ─── Fit map bounds to route ──────────────────────────────────────────────────
function FitBounds({ waypoints }) {
  const map = useMap();
  useEffect(() => {
    if (waypoints.length > 0) {
      const bounds = L.latLngBounds(waypoints.map(w => [w.lat, w.lon]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [waypoints, map]);
  return null;
}

function CaptureMap({ mapRef }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}


// ─── Shared utility ──────────────────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchGridWeather(bounds, gridRes = 2.0) {
  const south = Math.floor(bounds.south / gridRes) * gridRes;
  const north = Math.ceil(bounds.north / gridRes) * gridRes;
  const west = Math.floor(bounds.west / gridRes) * gridRes;
  const east = Math.ceil(bounds.east / gridRes) * gridRes;
  const lats = [], lons = [];
  for (let la = south; la <= north; la += gridRes) lats.push(parseFloat(la.toFixed(2)));
  for (let lo = west; lo <= east; lo += gridRes) lons.push(parseFloat(lo.toFixed(2)));
  if (lats.length * lons.length > 2500) throw new Error(`Grid too large (${lats.length}x${lons.length}=${lats.length*lons.length}). Zoom in or increase resolution.`);
  const points = [];
  for (const la of lats) for (const lo of lons) points.push({ lat: la, lon: lo });
  // Open-Meteo allows comma-separated lat/lon for multi-point (max ~50 per request)
  const batchSize = 40;
  const results = [];
  for (let i = 0; i < points.length; i += batchSize) {
    if (i > 0) await delay(300); // pace requests to avoid HTTP 429
    const batch = points.slice(i, i + batchSize);
    const latStr = batch.map(p => p.lat).join(",");
    const lonStr = batch.map(p => p.lon).join(",");
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${latStr}&longitude=${lonStr}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction&forecast_days=1&timeformat=unixtime`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) { batch.forEach(p => results.push({ ...p, weather: null, error: `HTTP ${resp.status}` })); continue; }
      const data = await resp.json();
      // Multi-point returns array; single returns object
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((d, j) => {
        if (d.error) { results.push({ ...batch[j], weather: null }); return; }
        const h = d.hourly;
        const now = Date.now();
        const idx = h.time.reduce((best, t, k) => Math.abs(t * 1000 - now) < Math.abs(h.time[best] * 1000 - now) ? k : best, 0);
        results.push({
          ...batch[j],
          weather: {
            waveHeight: h.wave_height?.[idx], wavePeriod: h.wave_period?.[idx], waveDir: h.wave_direction?.[idx],
            swellHeight: h.swell_wave_height?.[idx], swellPeriod: h.swell_wave_period?.[idx], swellDir: h.swell_wave_direction?.[idx],
          }
        });
      });
    } catch (e) { batch.forEach(p => results.push({ ...p, weather: null })); }
  }
  return { results, gridRes, bounds: { south, north, west, east } };
}

// ─── Weather along route fetcher (batched to avoid rate limits) ───────────────

async function fetchWeatherAlongRoute(samplePoints) {
  const results = [];
  const batchSize = 40;
  for (let i = 0; i < samplePoints.length; i += batchSize) {
    if (i > 0) await delay(300);
    const batch = samplePoints.slice(i, i + batchSize);
    const latStr = batch.map(p => p.lat.toFixed(2)).join(",");
    const lonStr = batch.map(p => p.lon.toFixed(2)).join(",");
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${latStr}&longitude=${lonStr}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction&forecast_days=1&timeformat=unixtime`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) { batch.forEach(pt => results.push({ ...pt, weather: null, error: `HTTP ${resp.status}` })); continue; }
      const data = await resp.json();
      const arr = Array.isArray(data) ? data : [data];
      arr.forEach((d, j) => {
        if (d.error || !d.hourly) { results.push({ ...batch[j], weather: null, error: d.reason || "No data" }); return; }
        const h = d.hourly;
        const now = Date.now();
        const idx = h.time.reduce((best, t, k) => Math.abs(t*1000-now) < Math.abs(h.time[best]*1000-now) ? k : best, 0);
        results.push({
          ...batch[j],
          weather: { waveHeight: h.wave_height?.[idx], waveDir: h.wave_direction?.[idx], wavePeriod: h.wave_period?.[idx],
            swellHeight: h.swell_wave_height?.[idx], swellPeriod: h.swell_wave_period?.[idx], swellDir: h.swell_wave_direction?.[idx] },
          error: null,
        });
      });
    } catch (e) { batch.forEach(pt => results.push({ ...pt, weather: null, error: e.message })); }
  }
  return results;
}

// ─── Parametric risk calculator (reused from App) ─────────────────────────────
function calcEncounterPeriod(Tw, V_kts, headingRel) {
  if (Tw <= 0) return Tw;
  const V = V_kts * 0.51444, alpha = headingRel * Math.PI / 180;
  const waveSpeed = (9.81 * Tw) / (2 * Math.PI);
  const denom = 1 - (V * Math.cos(alpha)) / waveSpeed;
  if (Math.abs(denom) < 0.01) return Infinity;
  return Tw / Math.abs(denom);
}
function calcParamRatio(Tr, Te) {
  if (Te <= 0 || Tr <= 0 || !isFinite(Te) || !isFinite(Tr)) return null;
  return Tr / (2 * Te);
}
function getRiskSeverity(ratio) {
  if (ratio === null) return 0;
  const dev = Math.abs(ratio - 1.0);
  if (dev <= 0.1) return 5; if (dev <= 0.2) return 4; if (dev <= 0.3) return 3;
  if (dev <= 0.4) return 2; if (dev <= 0.5) return 1; return 0;
}
function getRiskLabel(sev) { return ["MINIMAL","LOW","MODERATE","ELEVATED","HIGH","CRITICAL"][sev] || "UNKNOWN"; }

// ─── Styles ───────────────────────────────────────────────────────────────────
const panelBg = "#1E293B";
const inputStyle = { background: "#0F172A", border: "1px solid #334155", borderRadius: 4, color: "#E2E8F0", padding: "6px 8px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", width: "100%", boxSizing: "border-box", outline: "none" };
const btnStyle = { padding: "8px 16px", border: "none", borderRadius: 4, fontWeight: 800, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", letterSpacing: "0.08em", transition: "all 0.2s" };
const labelStyle = { color: "#94A3B8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3, display: "block", fontFamily: "'JetBrains Mono', monospace" };
const sectionHeader = (text) => (<div style={{ color: "#F59E0B", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #1E293B", paddingBottom: 6, marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>{text}</div>);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTE CHART COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function RouteChart({ shipParams }) {
  const [route, setRoute] = useState(null);
  const [routeStats, setRouteStats] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(null);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(true);
  const [sampleInterval, setSampleInterval] = useState(100);
  const [seaGrid, setSeaGrid] = useState(null);
  const [seaGridLoading, setSeaGridLoading] = useState(false);
  const [seaGridError, setSeaGridError] = useState(null);
  const [seaGridMode, setSeaGridMode] = useState("waveHeight");
  const [seaGridRes, setSeaGridRes] = useState(2.0);
  const [showSeaGrid, setShowSeaGrid] = useState(true);
  const mapRef = useRef(null);
  const fileInputRef = useRef(null);

  // Compute stats when route changes
  useEffect(() => {
    if (route?.waypoints) {
      setRouteStats(computeRouteStats(route.waypoints));
      setWeatherData(null);
    }
  }, [route]);

  // ─── File handling ────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    setParseError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = autoDetectAndParse(e.target.result, file.name);
        setRoute(parsed);
      } catch (err) {
        setParseError(err.message);
        setRoute(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const loadDemoRoute = () => {
    try {
      const parsed = autoDetectAndParse(generateSampleRTZ(), "demo.rtz");
      setRoute(parsed);
      setFileName("North_Atlantic_Westbound_Demo.rtz");
      setParseError(null);
    } catch (err) { setParseError(err.message); }
  };

  // ─── Weather fetch along route ────────────────────────────────────────────
  const fetchRouteWeather = async () => {
    if (!route?.waypoints) return;
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const samplePoints = generateWeatherSamplePoints(route.waypoints, sampleInterval);
      const data = await fetchWeatherAlongRoute(samplePoints);
      setWeatherData(data);
    } catch (err) {
      setWeatherError(err.message);
    }
    setWeatherLoading(false);
  };

  // ─── Sea area grid weather fetch ──────────────────────────────────────────
  const fetchSeaGridWeather = async () => {
    const map = mapRef.current;
    if (!map) return;
    setSeaGridLoading(true);
    setSeaGridError(null);
    try {
      const b = map.getBounds();
      const bounds = { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
      const data = await fetchGridWeather(bounds, seaGridRes);
      setSeaGrid(data);
    } catch (err) {
      setSeaGridError(err.message);
    }
    setSeaGridLoading(false);
  };

  // Compute risk for each weather point
  const weatherWithRisk = weatherData?.map(pt => {
    if (!pt.weather || !shipParams?.Tr) return { ...pt, risk: 0, ratio: null };
    const Tr = shipParams.Tr;
    const speed = shipParams.speed || 15;
    const relHdg = pt.weather.waveDir != null ? ((pt.weather.waveDir - (shipParams.heading || 0) + 360) % 360) : 0;
    const Te = calcEncounterPeriod(pt.weather.wavePeriod || 0, speed, relHdg);
    const ratio = calcParamRatio(Tr, Te);
    const risk = getRiskSeverity(ratio);
    return { ...pt, risk, ratio };
  }) || [];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, minHeight: 600 }}>
      {/* ── LEFT PANEL: Route Import & Info ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* File Import */}
        <div style={{ background: panelBg, borderRadius: 8, padding: 16, border: "1px solid #334155" }}>
          {sectionHeader("Route Import")}
          <div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8, lineHeight: 1.5 }}>
            Drop or select route file exported from ECDIS:<br/>
            <span style={{ color: "#F59E0B" }}>RTZ</span> (Furuno, JRC, Transas, Raytheon) · <span style={{ color: "#F59E0B" }}>CSV</span> · <span style={{ color: "#F59E0B" }}>GeoJSON</span>
          </div>
          <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()}
            style={{ border: "2px dashed #334155", borderRadius: 6, padding: 20, textAlign: "center", cursor: "pointer", background: "#0F172A", transition: "border-color 0.2s" }}
            onDragEnter={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#F59E0B"; }}
            onDragLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📂</div>
            <div style={{ color: "#94A3B8", fontSize: 11 }}>{fileName || "Drop .rtz / .csv / .geojson here"}</div>
            <div style={{ color: "#64748B", fontSize: 9, marginTop: 4 }}>or click to browse</div>
          </div>
          <input ref={fileInputRef} type="file" accept=".rtz,.csv,.txt,.geojson,.json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button onClick={loadDemoRoute} style={{ ...btnStyle, width: "100%", marginTop: 8, background: "linear-gradient(90deg, #334155, #475569)", color: "#E2E8F0" }}>
            ▶ LOAD DEMO: N.Atlantic Westbound
          </button>
          {parseError && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 6, padding: 6, background: "#7F1D1D20", borderRadius: 4 }}>{parseError}</div>}
        </div>

        {/* Route Info */}
        {route && (
          <div style={{ background: panelBg, borderRadius: 8, padding: 16, border: "1px solid #334155" }}>
            {sectionHeader("Route Info")}
            <div style={{ fontSize: 13, fontWeight: 700, color: "#F8FAFC", marginBottom: 6 }}>{route.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
              <div><span style={{ color: "#64748B" }}>Format:</span> <span style={{ color: "#22D3EE" }}>{route.format}</span></div>
              <div><span style={{ color: "#64748B" }}>Version:</span> <span style={{ color: "#22D3EE" }}>{route.version}</span></div>
              <div><span style={{ color: "#64748B" }}>Waypoints:</span> <span style={{ color: "#F59E0B" }}>{route.waypoints.length}</span></div>
              <div><span style={{ color: "#64748B" }}>Legs:</span> <span style={{ color: "#F59E0B" }}>{route.totalLegs}</span></div>
              {routeStats && <>
                <div style={{ gridColumn: "1/-1" }}><span style={{ color: "#64748B" }}>Total Distance:</span> <span style={{ color: "#3B82F6", fontWeight: 700 }}>{routeStats.totalNM.toFixed(1)} NM</span></div>
              </>}
            </div>
          </div>
        )}

        {/* Weather Fetch */}
        {route && (
          <div style={{ background: panelBg, borderRadius: 8, padding: 16, border: "1px solid #334155" }}>
            {sectionHeader("Route Weather")}
            <label style={labelStyle}>Sample Interval (NM)</label>
            <input type="number" value={sampleInterval} min={25} max={500} step={25} onChange={(e) => setSampleInterval(parseInt(e.target.value) || 100)} style={{ ...inputStyle, marginBottom: 8 }} />
            <button onClick={fetchRouteWeather} disabled={weatherLoading} style={{ ...btnStyle, width: "100%", background: weatherLoading ? "#334155" : "linear-gradient(90deg, #F59E0B, #D97706)", color: "#0F172A" }}>
              {weatherLoading ? "FETCHING..." : `⟳ FETCH WEATHER (${generateWeatherSamplePoints(route.waypoints, sampleInterval).length} pts)`}
            </button>
            {weatherError && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 6 }}>{weatherError}</div>}
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={showWeatherOverlay} onChange={(e) => setShowWeatherOverlay(e.target.checked)} style={{ accentColor: "#F59E0B" }} />
              <span style={{ color: "#94A3B8", fontSize: 11 }}>Show risk overlay on chart</span>
            </label>
          </div>
        )}

        {/* Sea Area Weather Overlay */}
        <div style={{ background: panelBg, borderRadius: 8, padding: 16, border: "1px solid #334155" }}>
          {sectionHeader("Sea Area Weather")}
          <div style={{ color: "#94A3B8", fontSize: 10, marginBottom: 8, lineHeight: 1.5 }}>
            Fetch gridded weather for the visible chart area. Pan/zoom to region of interest first.
          </div>
          <label style={labelStyle}>Grid Resolution (°)</label>
          <select value={seaGridRes} onChange={(e) => setSeaGridRes(parseFloat(e.target.value))} style={{ ...inputStyle, marginBottom: 8, cursor: "pointer" }}>
            <option value={1.0}>1.0° (fine — slow)</option>
            <option value={2.0}>2.0° (standard)</option>
            <option value={3.0}>3.0° (coarse — fast)</option>
            <option value={5.0}>5.0° (overview)</option>
          </select>
          <label style={labelStyle}>Overlay Mode</label>
          <select value={seaGridMode} onChange={(e) => setSeaGridMode(e.target.value)} style={{ ...inputStyle, marginBottom: 8, cursor: "pointer" }}>
            <option value="waveHeight">Wave Height (Hs)</option>
            <option value="wavePeriod">Wave Period (Tw)</option>
            <option value="risk">Parametric Roll Risk</option>
          </select>
          <button onClick={fetchSeaGridWeather} disabled={seaGridLoading} style={{ ...btnStyle, width: "100%", background: seaGridLoading ? "#334155" : "linear-gradient(90deg, #22D3EE, #3B82F6)", color: "#0F172A" }}>
            {seaGridLoading ? "FETCHING GRID..." : "🌊 FETCH SEA WEATHER"}
          </button>
          {seaGridError && <div style={{ color: "#EF4444", fontSize: 10, marginTop: 6 }}>{seaGridError}</div>}
          {seaGrid && <div style={{ color: "#64748B", fontSize: 9, marginTop: 6 }}>{seaGrid.results.length} grid points fetched</div>}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={showSeaGrid} onChange={(e) => setShowSeaGrid(e.target.checked)} style={{ accentColor: "#22D3EE" }} />
            <span style={{ color: "#94A3B8", fontSize: 11 }}>Show sea weather overlay</span>
          </label>
          {/* Legend */}
          {seaGrid && showSeaGrid && (() => {
            const legend = getColorLegend(seaGridMode);
            return (
              <div style={{ marginTop: 8, padding: 8, background: "#0F172A", borderRadius: 4, border: "1px solid #334155" }}>
                <div style={{ color: "#64748B", fontSize: 9, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {legend.title} — Gradient + Isolines
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {legend.items.map(({ label, color }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 1, background: color }} />
                      <span style={{ fontSize: 8, color: "#94A3B8" }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Leg Table */}
        {routeStats && (
          <div style={{ background: panelBg, borderRadius: 8, padding: 16, border: "1px solid #334155", overflowY: "auto", maxHeight: 250 }}>
            {sectionHeader("Legs")}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
              <thead>
                <tr style={{ color: "#64748B" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px", borderBottom: "1px solid #334155" }}>#</th>
                  <th style={{ textAlign: "left", padding: "2px 4px", borderBottom: "1px solid #334155" }}>From → To</th>
                  <th style={{ textAlign: "right", padding: "2px 4px", borderBottom: "1px solid #334155" }}>NM</th>
                  <th style={{ textAlign: "right", padding: "2px 4px", borderBottom: "1px solid #334155" }}>BRG°</th>
                </tr>
              </thead>
              <tbody>
                {routeStats.legs.map((leg, i) => (
                  <tr key={i} style={{ color: "#CBD5E1" }}>
                    <td style={{ padding: "2px 4px", borderBottom: "1px solid #1E293B" }}>{i + 1}</td>
                    <td style={{ padding: "2px 4px", borderBottom: "1px solid #1E293B", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{leg.from} → {leg.to}</td>
                    <td style={{ padding: "2px 4px", borderBottom: "1px solid #1E293B", textAlign: "right", color: "#3B82F6" }}>{leg.distNM.toFixed(1)}</td>
                    <td style={{ padding: "2px 4px", borderBottom: "1px solid #1E293B", textAlign: "right", color: "#F59E0B" }}>{leg.bearing.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL: Chart ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: panelBg, borderRadius: 8, border: "1px solid #334155", overflow: "hidden", flex: 1, minHeight: 450, position: "relative" }}>
          {route ? (
            <MapContainer center={[route.waypoints[0].lat, route.waypoints[0].lon]} zoom={5}
              style={{ height: "100%", width: "100%", background: "#0B1120" }}
              zoomControl={true} attributionControl={true}>
              {/* Base: OpenStreetMap dark */}
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
              />
              {/* OpenSeaMap nautical overlay */}
              <TileLayer
                url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>'
                opacity={0.7}
              />
              <CaptureMap mapRef={mapRef} />
              {/* Meteo canvas overlay: smooth gradient + isolines */}
              {showSeaGrid && seaGrid && (
                <MeteoCanvasOverlay gridData={seaGrid} mode={seaGridMode}
                  shipParams={{ Tr: shipParams?.Tr || 0, speed: shipParams?.speed || 15, heading: shipParams?.heading || 0 }} />
              )}
              {/* Fit bounds */}
              <FitBounds waypoints={route.waypoints} />
              {/* Route polyline */}
              <Polyline
                positions={route.waypoints.map(w => [w.lat, w.lon])}
                pathOptions={{ color: "#F59E0B", weight: 3, opacity: 0.9, dashArray: "8,6" }}
              />
              {/* Waypoint markers */}
              {route.waypoints.map((wp, i) => (
                <Marker key={wp.id} position={[wp.lat, wp.lon]}
                  icon={wpIcon(i === 0 ? "#16A34A" : i === route.waypoints.length - 1 ? "#DC2626" : "#3B82F6", i + 1)}>
                  <Tooltip direction="top" offset={[0, -14]} permanent={route.waypoints.length <= 12}>
                    <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{wp.name}</div>
                  </Tooltip>
                  <Popup>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>{wp.name}</div>
                      <div>Lat: {wp.lat.toFixed(4)}°</div>
                      <div>Lon: {wp.lon.toFixed(4)}°</div>
                      {wp.speed && <div>Plan Speed: {wp.speed} kts</div>}
                      {routeStats?.legs[i] && <div>Next leg: {routeStats.legs[i].distNM.toFixed(1)} NM @ {routeStats.legs[i].bearing.toFixed(0)}°T</div>}
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* Weather risk circles along route */}
              {showWeatherOverlay && weatherWithRisk.map((pt, i) => (
                <Circle key={`wx-${i}`} center={[pt.lat, pt.lon]}
                  radius={sampleInterval * 926} // NM to meters approx
                  pathOptions={{ color: riskColor(pt.risk), fillColor: riskColor(pt.risk), fillOpacity: 0.15, weight: 1, opacity: 0.4 }}>
                  <Popup>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                      <div style={{ fontWeight: 800, color: riskColor(pt.risk) }}>{getRiskLabel(pt.risk)} — R={pt.ratio?.toFixed(3) || "N/A"}</div>
                      <div>Pos: {pt.lat.toFixed(2)}°, {pt.lon.toFixed(2)}°</div>
                      {pt.weather && <>
                        <div>Hs: {pt.weather.waveHeight?.toFixed(1)}m | Tw: {pt.weather.wavePeriod?.toFixed(1)}s</div>
                        <div>Wave Dir: {pt.weather.waveDir?.toFixed(0)}°T</div>
                        {pt.weather.swellHeight && <div>Swell: {pt.weather.swellHeight?.toFixed(1)}m / {pt.weather.swellPeriod?.toFixed(1)}s</div>}
                      </>}
                      {pt.error && <div style={{ color: "#EF4444" }}>{pt.error}</div>}
                    </div>
                  </Popup>
                </Circle>
              ))}
            </MapContainer>
          ) : (
            /* Default map (no route loaded) — still supports sea weather overlay */
            <MapContainer center={[45, -20]} zoom={4}
              style={{ height: "100%", width: "100%", background: "#0B1120" }}
              zoomControl={true} attributionControl={true}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>' />
              <TileLayer url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>' opacity={0.7} />
              <CaptureMap mapRef={mapRef} />
              {showSeaGrid && seaGrid && (
                <MeteoCanvasOverlay gridData={seaGrid} mode={seaGridMode}
                  shipParams={{ Tr: shipParams?.Tr || 0, speed: shipParams?.speed || 15, heading: shipParams?.heading || 0 }} />
              )}
            </MapContainer>
          )}
        </div>

        {/* Weather strip along route */}
        {weatherWithRisk.length > 0 && (
          <div style={{ background: panelBg, borderRadius: 8, padding: 12, border: "1px solid #334155" }}>
            {sectionHeader("Route Weather Profile — Risk by Position")}
            <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 60, overflowX: "auto" }}>
              {weatherWithRisk.map((pt, i) => (
                <div key={i} title={`${pt.name}: ${getRiskLabel(pt.risk)} (Hs=${pt.weather?.waveHeight?.toFixed(1) || "?"}m)`}
                  style={{
                    flex: "1 0 8px", minWidth: 8, maxWidth: 20,
                    height: `${Math.max(10, (pt.weather?.waveHeight || 0) / 8 * 100)}%`,
                    background: riskColor(pt.risk), borderRadius: "2px 2px 0 0",
                    opacity: 0.8, cursor: "pointer", transition: "opacity 0.2s",
                  }}
                  onMouseEnter={(e) => e.target.style.opacity = 1}
                  onMouseLeave={(e) => e.target.style.opacity = 0.8}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>
              <span>{route?.waypoints[0]?.name}</span>
              <span>{routeStats?.totalNM.toFixed(0)} NM</span>
              <span>{route?.waypoints[route.waypoints.length - 1]?.name}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
