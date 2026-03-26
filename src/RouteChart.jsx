// ─── RouteChart.jsx ───────────────────────────────────────────────────────────
// Route chart — map + route display, coordinates child panels.
// Panels extracted to src/ui/route/ — Phase 1, Item 2
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { autoDetectAndParse, computeRouteStats, generateWeatherSamplePoints,
         generateSampleRTZ } from "./RouteParser.js";
import MeteoCanvasOverlay from "./MeteoOverlay.jsx";
import { buildGridPoints, fetchAtmosphericGrid,
         fetchMarineUnified, fetchCmemsPhysicsGrid,
         closestHourIdx, calcVoyageETAs } from "./weatherApi.js";
import { cumulativeDistances } from "./core/voyageEngine.js";
import { cacheStatus, cacheInvalidate } from "./weatherCache.js";
import { loadCmemsCredentials } from "./cmemsProvider.js";
import { calcMotions, getMotionStatus } from "./physics.js";
import { sanitizeWxSnapshot } from "./weatherValidation.js";
import { fetchRouteWeather } from "./weather/routeWeatherPipeline.js";
import FetchProgressBar from "./ui/route/FetchProgressBar.jsx";
import { useAppState, useAppActions } from "./state/appStore.jsx";
import { saveWxSession, loadWxSession } from "./services/wxSessionStore.js";
import { calcCurrentPosition, ShipPositionLayer,
         ShipPolarDiagram, ShipInfoPanel } from "./ShipDashboard.jsx";
// ── Extracted child components ──
import ForecastScrubber from "./ui/route/ForecastScrubber.jsx";
import WaypointEditor from "./ui/route/WaypointEditor.jsx";
import VoyagePlan from "./ui/route/VoyagePlan.jsx";
import WeatherProviderPanel from "./ui/route/WeatherProviderPanel.jsx";
import SynopticOverlayPanel from "./ui/route/SynopticOverlayPanel.jsx";
import VoyageRiskTimeline from "./ui/route/VoyageRiskTimeline.jsx";
import RouteRiskScan from "./ui/route/RouteRiskScan.jsx";
import { riskColor, panelBg, btnSt, inputSt, SH, Panel } from "./ui/route/shared.jsx";
import { fmtLat, fmtLon } from "./ui/components/NauticalCoord.jsx";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Map helpers & marker icons ──────────────────────────────────────────────
function FitBounds({waypoints}){
  const map=useMap();
  useEffect(()=>{if(waypoints.length>0){map.fitBounds(L.latLngBounds(waypoints.map(w=>[w.lat,w.lon])),{padding:[40,40]});}
  },[waypoints,map]);return null;
}
function CaptureMap({mapRef}){const map=useMap();useEffect(()=>{mapRef.current=map;},[map,mapRef]);return null;}

const makeWpIcon = (color, label, size=28) => L.divIcon({
  className:"", iconSize:[size,size], iconAnchor:[size/2,size/2],
  html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
    border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;
    font-size:${size<26?8:10}px;font-weight:900;color:#fff;
    font-family:'JetBrains Mono',monospace;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:grab">${label}</div>`,
});
const bospIcon = makeWpIcon("#16A34A","▶",32);
const eospIcon = makeWpIcon("#DC2626","■",32);
const riskIcon = (severity, label) => makeWpIcon(riskColor(severity), label, 22);

function DraggableWpMarker({ wp, idx, onMove }) {
  const markerRef = useRef(null);
  const icon = L.divIcon({ className:"", iconSize:[22,22], iconAnchor:[11,11],
    html:`<div style="width:22px;height:22px;border-radius:50%;background:#F59E0B;
      border:2px solid #fff;display:flex;align-items:center;justify-content:center;
      font-size:8px;font-weight:900;color:#0F172A;cursor:grab;
      box-shadow:0 2px 8px rgba(0,0,0,0.6)">${idx+1}</div>` });
  return (
    <Marker ref={markerRef} position={[wp.lat,wp.lon]} icon={icon} draggable={true}
      eventHandlers={{ dragend: e => { const {lat,lng}=e.target.getLatLng(); onMove(idx,parseFloat(lat.toFixed(5)),parseFloat(lng.toFixed(5))); } }}>
      <Tooltip direction="top" offset={[0,-12]}>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>{wp.name||`WP${idx+1}`}<br/>{fmtLat(wp.lat)}<br/>{fmtLon(wp.lon)}</span>
      </Tooltip>
    </Marker>
  );
}

function WpPopup({ wp, shipParams }) {
  const w = wp.weather;
  return (
    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,minWidth:200}}>
      <div style={{fontWeight:800,color:"#F59E0B",marginBottom:6,fontSize:13}}>{wp.name||`WP ${wp.id}`}</div>
      {wp.etaMs && <div style={{color:"#22D3EE",marginBottom:4}}>ETA: {new Date(wp.etaMs).toUTCString().slice(0,25)} UTC</div>}
      {wp.cumNM!=null && <div style={{color:"#94A3B8",marginBottom:6}}>Dist from BOSP: {wp.cumNM.toFixed(1)} NM</div>}
      {w ? <>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
          <div><span style={{color:"#64748B"}}>Hs:</span> <b style={{color:"#3B82F6"}}>{w.waveHeight?.toFixed(1)||"—"}m</b></div>
          <div><span style={{color:"#64748B"}}>Tw:</span> <b style={{color:"#3B82F6"}}>{w.wavePeriod?.toFixed(1)||"—"}s</b></div>
          <div><span style={{color:"#64748B"}}>Swell:</span> <b style={{color:"#F59E0B"}}>{w.swellHeight?.toFixed(1)||"—"}m/{w.swellPeriod?.toFixed(0)||"—"}s</b></div>
          <div><span style={{color:"#64748B"}}>WDir:</span> <b>{w.waveDir?.toFixed(0)||"—"}°T</b></div>
          {w.windKts!=null && <>
            <div><span style={{color:"#64748B"}}>Wind:</span> <b style={{color:"#22D3EE"}}>{w.windKts?.toFixed(0)} kts</b></div>
            <div><span style={{color:"#64748B"}}>From:</span> <b>{w.windDir?.toFixed(0)||"—"}°T</b></div></>}
          {w.mslp!=null && <div style={{gridColumn:"1/-1"}}><span style={{color:"#64748B"}}>MSLP:</span> <b style={{color:"#A855F7"}}>{w.mslp?.toFixed(0)} hPa</b></div>}
        </div>
        {wp.motions && <div style={{marginTop:6,borderTop:"1px solid #334155",paddingTop:6}}>
          <div style={{color:wp.motionStatus?.color||"#94A3B8",fontWeight:800}}>{wp.motionStatus?.label||"—"}</div>
          <div>Roll: {wp.motions.roll?.toFixed(1)||"—"}° | Pitch: {wp.motions.pitch?.toFixed(1)||"—"}°</div>
          <div>Bridge: {wp.motions.bridgeAcc?.toFixed(2)||"—"} m/s² | Slam: {((wp.motions.slam??0)*100).toFixed(0)}%</div>
          <div style={{color:"#94A3B8"}}>Param Risk: {((wp.motions.paramRisk??0)*100).toFixed(0)}%</div>
        </div>}
      </> : <div style={{color:"#64748B",fontSize:10}}>No weather data — fetch voyage weather first</div>}
    </div>
  );
}

// ═══ Main component ═══════════════════════════════════════════════════════════
export default function RouteChart({ shipParams }) {
  const appState = useAppState();
  const appActions = useAppActions();
  const [route, setRoute] = useState(null);
  const [routeStats, setRouteStats] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editForm, setEditForm] = useState({});
  const nowUTC = () => { const d=new Date(); d.setSeconds(0,0); return d.toISOString().slice(0,16); };
  const [bospDT, setBospDT] = useState(nowUTC);
  const [voyageSpeed, setVoyageSpeed] = useState(shipParams?.speed||15);
  const [bospIdx, setBospIdx] = useState(0);
  const [eospIdx, setEospIdx] = useState(null); // null = last WP
  const [legSpeeds, setLegSpeeds] = useState({}); // {wpIndex: speed} per-leg overrides
  const [voyageWPs, setVoyageWPs] = useState(null);
  const [voyageWeather, setVoyageWeather] = useState(null);
  const [vwLoading, setVwLoading] = useState(false);
  const [vwError, setVwError] = useState(null);
  const [marineGrid, setMarineGrid] = useState(null);
  const [atmoGrid, setAtmoGrid] = useState(null);
  const [gridRes, setGridRes] = useState(0.5);
  const [gridMode, setGridMode] = useState("waveHeight");
  const [showGrid, setShowGrid] = useState(true);
  const [showAtmo, setShowAtmo] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState(null);
  const [gridProgress, setGridProgress] = useState(null);
  const [cmemsUser, setCmemsUser] = useState("");
  const [cmemsPass, setCmemsPass] = useState("");
  useEffect(() => { loadCmemsCredentials().then(({user,pass})=>{setCmemsUser(user);setCmemsPass(pass);}); }, []);
  const [cmemsProvider, setCmemsProvider] = useState("auto");
  const [cmemsTestMsg, setCmemsTestMsg] = useState(null);
  const [cmemsTestOk, setCmemsTestOk] = useState(null);
  const [cmemsTestLoading, setCmemsTestLoading] = useState(false);
  const [physicsGrid, setPhysicsGrid] = useState(null);
  const [showCurrents, setShowCurrents] = useState(true);
  const cmemsCredentials = cmemsUser && cmemsPass ? { user: cmemsUser, pass: cmemsPass } : null;
  const [chartHourIdx, setChartHourIdx] = useState(0);
  const [stepSize, setStepSize] = useState(6);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(600);
  const [cacheInfo, setCacheInfo] = useState([]);
  const [lastFetchSrc, setLastFetchSrc] = useState(null);
  const [gridFetchedAt, setGridFetchedAt] = useState(null);
  const playRef = useRef(null);
  const mapRef = useRef(null);
  const fileRef = useRef(null);

  // ── Unified pipeline state (Phase 3) ──
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState({ stage: null, pct: 0, detail: "" });
  const [pipelineFamily, setPipelineFamily] = useState(null);

  // ── Route persistence: load saved route on mount, save on change ──
  useEffect(() => {
    if (!route && appState.lastRoute) {
      setRoute(appState.lastRoute.route);
      setFileName(appState.lastRoute.fileName || "Restored route");
      if (appState.lastRoute.bospDT) setBospDT(appState.lastRoute.bospDT);
      if (appState.lastRoute.voyageSpeed) setVoyageSpeed(appState.lastRoute.voyageSpeed);
      if (appState.lastRoute.bospIdx != null) setBospIdx(appState.lastRoute.bospIdx);
      if (appState.lastRoute.eospIdx != null) setEospIdx(appState.lastRoute.eospIdx);
      if (appState.lastRoute.legSpeeds) setLegSpeeds(appState.lastRoute.legSpeeds);
    }
  }, []); // mount only

  useEffect(() => {
    if (route?.waypoints?.length) {
      appActions.setLastRoute({ route, fileName, bospDT, voyageSpeed, bospIdx, eospIdx, legSpeeds });
    }
  }, [route, fileName, bospDT, voyageSpeed, bospIdx, eospIdx, legSpeeds]);

  // ── Restore weather state on mount (IndexedDB — survives tab switch + restart) ──
  useEffect(() => {
    loadWxSession().then(saved => {
      if (!saved) return;
      // Validate: voyageWeather points must have valid lat/lon
      if (saved.voyageWeather?.length) {
        const valid = saved.voyageWeather.every(p => p && typeof p.lat === "number" && typeof p.lon === "number");
        if (!valid) { console.warn("[wxRestore] invalid voyageWeather — skipping restore"); return; }
      }
      try {
        if (saved.marineGrid?.results?.length) setMarineGrid(saved.marineGrid);
        if (saved.atmoGrid?.results?.length) setAtmoGrid(saved.atmoGrid);
        if (saved.physicsGrid?.results?.length) setPhysicsGrid(saved.physicsGrid);
        if (saved.voyageWeather?.length) setVoyageWeather(saved.voyageWeather);
        if (saved.voyageWPs?.length) setVoyageWPs(saved.voyageWPs);
        if (saved.pipelineFamily) setPipelineFamily(saved.pipelineFamily);
        if (saved.chartHourIdx != null) setChartHourIdx(saved.chartHourIdx);
      } catch (e) { console.warn("[wxRestore] error during restore:", e.message); }
    }).catch(() => {});
  }, []); // mount only

  // ── Dynamic polar context: hover point > scrubber position > live ship ──
  const [hoveredRouteIdx, setHoveredRouteIdx] = useState(null);
  const anyLoading = vwLoading||gridLoading;
  const [shipPos, setShipPos] = useState(null);
  const [shipWx, setShipWx] = useState(null);
  const [shipMotion, setShipMotion] = useState(null);
  const [shipMStat, setShipMStat] = useState(null);

  // ── Effects ──
  useEffect(() => {
    function tick() {
      if (!voyageWPs?.length) return;
      const pos = calcCurrentPosition(voyageWPs);
      setShipPos(pos);
      if (pos?.status === "underway" && voyageWeather?.length) {
        const closest = voyageWeather.reduce((best, p) => {
          const d = Math.hypot(p.lat - pos.lat, p.lon - pos.lon);
          return d < Math.hypot(best.lat - pos.lat, best.lon - pos.lon) ? p : best;
        });
        setShipWx(closest.weather || null);
        setShipMotion(closest.motions || null);
        setShipMStat(closest.motionStatus || null);
      }
    }
    tick(); const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [voyageWPs, voyageWeather]);

  const maxHourIdx = marineGrid?.results?.find(r=>r.times)?.times?.length ?? 168;

  useEffect(() => {
    if (playRef.current) clearInterval(playRef.current);
    if (!playing || !marineGrid) return;
    playRef.current = setInterval(() => {
      setChartHourIdx(prev => { const next = prev + stepSize; if (next >= maxHourIdx) { setPlaying(false); return maxHourIdx - 1; } return next; });
    }, playSpeed);
    return () => clearInterval(playRef.current);
  }, [playing, stepSize, playSpeed, marineGrid, maxHourIdx]);

  useEffect(() => { setCacheInfo(cacheStatus()); }, [marineGrid, atmoGrid]);

  useEffect(() => {
    if (route?.waypoints) {
      setRouteStats(computeRouteStats(route.waypoints));
      setVoyageWPs(null); setVoyageWeather(null);
      setShipPos(null); setShipWx(null); setShipMotion(null); setShipMStat(null);
    }
  }, [route]);

  // ── File handling ──
  const handleFile = useCallback(file => {
    setParseError(null); setFileName(file.name);
    const r = new FileReader();
    r.onload = e => { try { setRoute(autoDetectAndParse(e.target.result, file.name)); } catch(err) { setParseError(err.message); setRoute(null); } };
    r.readAsText(file);
  }, []);
  const loadDemo = () => { try { setRoute(autoDetectAndParse(generateSampleRTZ(),"demo.rtz")); setFileName("N.Atlantic_Demo.rtz"); } catch(e) { setParseError(e.message); } };

  // ── WP mutations ──
  const mutateWps = (newWps) => {
    if (newWps.length < 2) return;
    const renumbered = newWps.map((w,i) => ({ ...w, id: String(i+1), name: w.name || `WP${String(i+1).padStart(3,"0")}` }));
    setRoute(r => ({ ...r, waypoints: renumbered }));
    setVoyageWPs(null); setVoyageWeather(null);
    setShipPos(null); setShipWx(null); setShipMotion(null); setShipMStat(null);
    setEditingIdx(null);
  };
  const wpDelete = (idx) => { if (!route?.waypoints || route.waypoints.length <= 2) return; mutateWps(route.waypoints.filter((_,i) => i !== idx)); };
  const wpInsertAfter = (idx) => {
    const wps = route.waypoints; const a = wps[idx], b = wps[idx+1] || a;
    const midLat = parseFloat(((a.lat+b.lat)/2).toFixed(5)); const midLon = parseFloat(((a.lon+b.lon)/2).toFixed(5));
    mutateWps([...wps.slice(0,idx+1), { id:"", name:"", lat:midLat, lon:midLon, speed:a.speed||null }, ...wps.slice(idx+1)]);
    setEditingIdx(idx+1); setEditForm({ name:"", lat:midLat.toFixed(5), lon:midLon.toFixed(5) });
  };
  const wpMove = (idx, lat, lon) => { const wps = [...route.waypoints]; wps[idx] = { ...wps[idx], lat, lon }; mutateWps(wps); };
  const wpSaveEdit = (idx) => {
    const wps = [...route.waypoints]; const lat = parseFloat(editForm.lat); const lon = parseFloat(editForm.lon);
    if (isNaN(lat)||isNaN(lon)||lat<-90||lat>90||lon<-180||lon>180) return;
    wps[idx] = { ...wps[idx], name: editForm.name||wps[idx].name, lat, lon }; mutateWps(wps);
  };
  const wpMoveUp = (idx) => { if(idx<1) return; const w=[...route.waypoints]; [w[idx-1],w[idx]]=[w[idx],w[idx-1]]; mutateWps(w); };
  const wpMoveDown = (idx) => { if(idx>=route.waypoints.length-1) return; const w=[...route.waypoints]; [w[idx],w[idx+1]]=[w[idx+1],w[idx]]; mutateWps(w); };

  // ── UNIFIED FETCH: single-action route weather pipeline ──────────────────
  const fetchAllRouteWeather = async (forceRefresh = false) => {
    if (!route?.waypoints?.length) return;
    setPipelineRunning(true);
    setPipelineProgress({ stage: "Initializing...", pct: 0, detail: "" });
    setVwError(null); setGridError(null);
    try {
      const map = mapRef.current;
      const b = map?.getBounds();
      const mapBounds = b ? { south: b.getSouth(), north: b.getNorth(),
        west: b.getWest(), east: b.getEast() } : null;
      const creds = (cmemsUser && cmemsPass) ? { user: cmemsUser, pass: cmemsPass } : null;
      const result = await fetchRouteWeather({
        waypoints: route.waypoints, bospDT, voyageSpeed, shipParams,
        mapBounds, gridRes, showAtmo, showCurrents: !!creds,
        cmemsCredentials: creds, cmemsProvider,
        forceRefresh,
        onProgress: (stage, pct, detail) =>
          setPipelineProgress({ stage, pct, detail }),
      });
      // Apply results to state
      if (result.voyageWPs) setVoyageWPs(result.voyageWPs);
      if (result.voyageWeather) setVoyageWeather(result.voyageWeather);
      if (result.marineGrid) {
        setMarineGrid(result.marineGrid);
        setLastFetchSrc(result.marineGrid.fromCache ? "cache" : "network");
        setGridFetchedAt(result.marineGrid.fetchedAt);
      }
      if (result.atmoGrid) setAtmoGrid(result.atmoGrid);
      if (result.physicsGrid) setPhysicsGrid(result.physicsGrid);
      setPipelineFamily(result.modelFamily);
      setChartHourIdx(0); setPlaying(false); setCacheInfo(cacheStatus());

      // ── Persist weather state to IndexedDB (survives tab switch + restart) ──
      saveWxSession({
        marineGrid: result.marineGrid,
        atmoGrid: result.atmoGrid,
        physicsGrid: result.physicsGrid,
        voyageWeather: result.voyageWeather,
        voyageWPs: result.voyageWPs,
        pipelineFamily: result.modelFamily,
        chartHourIdx: 0,
      });
    } catch (e) {
      setGridError(e.message); setVwError(e.message);
    }
    setPipelineRunning(false);
  };

  // ── Voyage calc (kept for manual ETA recalc without refetching weather) ──
  const calcVoyage = () => {
    if (!route?.waypoints) return;
    const ei = eospIdx ?? (route.waypoints.length - 1);
    setVoyageWPs(calcVoyageETAs(route.waypoints, new Date(bospDT + 'Z').getTime(), voyageSpeed,
      { bospIdx, eospIdx: ei, legSpeeds }));
    setVoyageWeather(null);
  };

  // ── Fetch voyage weather (legacy — delegates to unified pipeline) ──
  const fetchVoyageWeather = () => fetchAllRouteWeather(false);

  // ── Fetch synoptic overlay (legacy — delegates to unified pipeline) ──
  const fetchSeaOverlay = (forceRefresh = false) => fetchAllRouteWeather(forceRefresh);

  // ── Computed ──
  const eosp = voyageWPs?.[voyageWPs.length-1];
  const eospStr = eosp ? new Date(eosp.etaMs).toUTCString().slice(0,25)+' UTC' : '—';
  const voyageDaysStr = eosp ? ((eosp.etaMs - new Date(bospDT + 'Z').getTime())/86400000).toFixed(1) : '—';
  const maxRisk = voyageWeather ? Math.max(...voyageWeather.map(p=>p.riskSeverity)) : 0;

  // ── Dynamic polar context: resolves hover > scrubber > live ship ──────────
  const polarCtx = useMemo(() => {
    // Priority 1: Hovered route point
    if (hoveredRouteIdx != null && voyageWeather?.[hoveredRouteIdx]) {
      const pt = voyageWeather[hoveredRouteIdx];
      return { source: "hover", label: `WP hover — ${pt.name || `Sample ${hoveredRouteIdx + 1}`}`,
        lat: pt.lat, lon: pt.lon, heading: pt.heading || 0, cog: pt.heading || 0,
        weather: pt.weather, motions: pt.motions, motionStatus: pt.motionStatus,
        etaMs: pt.etaMs };
    }
    // Priority 2: Scrubber position — find voyage point closest to scrubber time
    if (voyageWeather?.length && marineGrid?.results?.[0]?.times && chartHourIdx > 0) {
      const times = marineGrid.results[0].times;
      const scrubMs = typeof times[chartHourIdx] === "number" && times[chartHourIdx] < 1e12
        ? times[chartHourIdx] * 1000 : times[chartHourIdx];
      if (scrubMs) {
        const closest = voyageWeather.reduce((best, pt) =>
          Math.abs((pt.etaMs || 0) - scrubMs) < Math.abs((best.etaMs || 0) - scrubMs) ? pt : best);
        if (closest?.weather) return {
          source: "scrubber", label: `Projected — ${new Date(scrubMs).toUTCString().slice(0, 22)} UTC`,
          lat: closest.lat, lon: closest.lon, heading: closest.heading || 0, cog: closest.heading || 0,
          weather: closest.weather, motions: closest.motions, motionStatus: closest.motionStatus,
          etaMs: closest.etaMs };
      }
    }
    // Priority 3: Live ship position
    if (shipPos?.status === "underway" && shipWx) {
      return { source: "live", label: "Live ship position",
        lat: shipPos.lat, lon: shipPos.lon, heading: shipPos.heading, cog: shipPos.cog,
        weather: shipWx, motions: shipMotion, motionStatus: shipMStat };
    }
    // Fallback: first voyage point with weather
    if (voyageWeather?.length) {
      const first = voyageWeather.find(p => p.weather);
      if (first) return { source: "route", label: `BOSP — ${first.name || "WP1"}`,
        lat: first.lat, lon: first.lon, heading: first.heading || 0, cog: first.heading || 0,
        weather: first.weather, motions: first.motions, motionStatus: first.motionStatus };
    }
    return null;
  }, [hoveredRouteIdx, voyageWeather, chartHourIdx, marineGrid, shipPos, shipWx, shipMotion, shipMStat]);

  // ═══ RENDER ═══════════════════════════════════════════════════════════════
  return (
    <div style={{display:"grid",gridTemplateColumns:"310px 1fr",gap:16,alignItems:"start"}}>
      {/* ═══ LEFT PANEL ═══ */}
      <div style={{display:"flex",flexDirection:"column",gap:12,overflowY:"auto",position:"sticky",top:80,maxHeight:"calc(100vh - 90px)"}}>
        {/* Route Import */}
        <Panel>
          {SH("Route Import")}
          <div style={{color:"#94A3B8",fontSize:10,marginBottom:8,lineHeight:1.5}}>
            Drop/select route from ECDIS:<br/>
            <span style={{color:"#F59E0B"}}>RTZ</span> (Furuno, JRC, Transas) · <span style={{color:"#F59E0B"}}>CSV</span> · <span style={{color:"#F59E0B"}}>GeoJSON</span>
          </div>
          <div onDrop={e=>{e.preventDefault();e.dataTransfer?.files?.[0]&&handleFile(e.dataTransfer.files[0]);}}
            onDragOver={e=>e.preventDefault()} onClick={()=>fileRef.current?.click()}
            style={{border:"2px dashed #334155",borderRadius:6,padding:20,textAlign:"center",cursor:"pointer",background:"#0F172A"}}
            onDragEnter={e=>e.currentTarget.style.borderColor="#F59E0B"} onDragLeave={e=>e.currentTarget.style.borderColor="#334155"}>
            <div style={{fontSize:22,marginBottom:4}}>📂</div>
            <div style={{color:"#94A3B8",fontSize:11}}>{fileName||"Drop .rtz / .csv / .geojson"}</div>
            <div style={{color:"#64748B",fontSize:9,marginTop:3}}>or click to browse</div>
          </div>
          <input ref={fileRef} type="file" accept=".rtz,.csv,.txt,.geojson,.json" style={{display:"none"}}
            onChange={e=>e.target.files?.[0]&&handleFile(e.target.files[0])} />
          <button onClick={loadDemo} style={{...btnSt,width:"100%",marginTop:8,background:"linear-gradient(90deg,#334155,#475569)",color:"#E2E8F0"}}>
            ▶ DEMO — North Atlantic Westbound</button>
          {parseError&&<div style={{color:"#EF4444",fontSize:10,marginTop:6,padding:6,background:"#7F1D1D20",borderRadius:4}}>{parseError}</div>}
        </Panel>

        <WaypointEditor route={route} editMode={editMode} setEditMode={setEditMode}
          editingIdx={editingIdx} setEditingIdx={setEditingIdx} editForm={editForm} setEditForm={setEditForm}
          wpDelete={wpDelete} wpInsertAfter={wpInsertAfter} wpSaveEdit={wpSaveEdit}
          wpMoveUp={wpMoveUp} wpMoveDown={wpMoveDown} />

        <VoyagePlan route={route} bospDT={bospDT} setBospDT={setBospDT}
          voyageSpeed={voyageSpeed} setVoyageSpeed={setVoyageSpeed}
          bospIdx={bospIdx} setBospIdx={setBospIdx}
          eospIdx={eospIdx ?? (route?.waypoints?.length - 1 || 0)} setEospIdx={setEospIdx}
          legSpeeds={legSpeeds} setLegSpeeds={setLegSpeeds}
          calcVoyage={calcVoyage} voyageWPs={voyageWPs} eospStr={eospStr} voyageDaysStr={voyageDaysStr} />

        {/* Live Ship Position */}
        {voyageWPs && <Panel>
          {SH("⛵ Ship Position")}
          <ShipInfoPanel pos={shipPos} weather={shipWx} shipParams={shipParams} motions={shipMotion} motionStatus={shipMStat} />
        </Panel>}

        {/* ── Unified Route Weather Fetch (single action) ── */}
        {voyageWPs && <Panel>
          {SH("🌊 Fetch Route Weather")}
          <div style={{color:"#94A3B8",fontSize:10,lineHeight:1.5,marginBottom:8}}>
            Single action: synoptic grid + voyage weather + seakeeping motions.
            Uses coherent model family (same source for marine &amp; wind).
          </div>
          {pipelineFamily && !pipelineRunning && <div style={{color:"#64748B",fontSize:9,marginBottom:6}}>
            Last fetch: <b style={{color:"#22C55E"}}>{pipelineFamily.label}</b>
          </div>}
          <FetchProgressBar stage={pipelineProgress.stage} pct={pipelineProgress.pct}
            detail={pipelineProgress.detail} modelFamily={pipelineFamily} />
          <div style={{display:"flex",gap:6}}>
            <button onClick={() => fetchAllRouteWeather(false)} disabled={pipelineRunning}
              style={{...btnSt,flex:1,background:pipelineRunning?"#334155":"linear-gradient(90deg,#F59E0B,#D97706)",color:"#0F172A",fontWeight:800}}>
              {pipelineRunning ? "⟳ FETCHING..." : "⟳ FETCH ROUTE WEATHER"}</button>
            <button onClick={() => fetchAllRouteWeather(true)} disabled={pipelineRunning}
              style={{...btnSt,background:"#33415580",color:"#94A3B8",padding:"6px 10px",fontSize:9}}
              title="Force refresh — bypass cache">🔄</button>
          </div>
          {(vwError||gridError)&&<div style={{color:"#EF4444",fontSize:10,marginTop:6,padding:6,background:"#7F1D1D20",borderRadius:4}}>{vwError||gridError}</div>}
          {voyageWeather&&!pipelineRunning&&<div style={{color:"#64748B",fontSize:9,marginTop:4}}>
            {voyageWeather.length} points assessed · Max risk: <span style={{color:riskColor(maxRisk),fontWeight:800}}>{["MIN","LOW","MOD","ELEV","HIGH","CRIT","FORB"][maxRisk]}</span>
          </div>}
        </Panel>}

        <WeatherProviderPanel cmemsUser={cmemsUser} setCmemsUser={setCmemsUser}
          cmemsPass={cmemsPass} setCmemsPass={setCmemsPass}
          cmemsProvider={cmemsProvider} setCmemsProvider={setCmemsProvider} cmemsCredentials={cmemsCredentials}
          cmemsTestMsg={cmemsTestMsg} setCmemsTestMsg={setCmemsTestMsg}
          cmemsTestOk={cmemsTestOk} setCmemsTestOk={setCmemsTestOk}
          cmemsTestLoading={cmemsTestLoading} setCmemsTestLoading={setCmemsTestLoading}
          showCurrents={showCurrents} setShowCurrents={setShowCurrents} />

        <SynopticOverlayPanel gridRes={gridRes} setGridRes={setGridRes}
          gridMode={gridMode} setGridMode={setGridMode} showAtmo={showAtmo} setShowAtmo={setShowAtmo}
          showGrid={showGrid} setShowGrid={setShowGrid} fetchSeaOverlay={fetchSeaOverlay}
          anyLoading={anyLoading} gridLoading={gridLoading} gridProgress={gridProgress}
          gridError={gridError} marineGrid={marineGrid} maxHourIdx={maxHourIdx}
          lastFetchSrc={lastFetchSrc} cacheInfo={cacheInfo} setCacheInfo={setCacheInfo} />

        {/* WP ETA table */}
        {voyageWPs && <Panel>
          {SH("Waypoint ETAs")}
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,fontFamily:"'JetBrains Mono',monospace"}}>
            <thead><tr style={{color:"#64748B"}}>
              <th style={{textAlign:"left",padding:"2px 3px",borderBottom:"1px solid #334155"}}>#</th>
              <th style={{textAlign:"left",padding:"2px 3px",borderBottom:"1px solid #334155"}}>Name</th>
              <th style={{textAlign:"right",padding:"2px 3px",borderBottom:"1px solid #334155"}}>NM</th>
              <th style={{textAlign:"right",padding:"2px 3px",borderBottom:"1px solid #334155"}}>ETA (UTC)</th>
            </tr></thead>
            <tbody>{voyageWPs.map((wp,i)=>(
              <tr key={i} style={{color:"#CBD5E1",background:i===0||i===voyageWPs.length-1?"#0F172A40":"transparent"}}>
                <td style={{padding:"2px 3px",borderBottom:"1px solid #1E293B",color:i===0?"#16A34A":i===voyageWPs.length-1?"#DC2626":"#F59E0B",fontWeight:800}}>{i+1}</td>
                <td style={{padding:"2px 3px",borderBottom:"1px solid #1E293B",maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{wp.name||`WP${i+1}`}</td>
                <td style={{padding:"2px 3px",borderBottom:"1px solid #1E293B",textAlign:"right",color:"#3B82F6"}}>{wp.cumNM?.toFixed(0)||"0"}</td>
                <td style={{padding:"2px 3px",borderBottom:"1px solid #1E293B",textAlign:"right",color:"#94A3B8",fontSize:8}}>{new Date(wp.etaMs).toUTCString().slice(5,22)}</td>
              </tr>))}</tbody>
          </table>
        </Panel>}
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Map */}
        <div style={{background:panelBg,borderRadius:8,border:"1px solid #334155",overflow:"hidden",height:520,position:"relative"}}>
          <MapContainer center={route?[route.waypoints[0].lat,route.waypoints[0].lon]:[45,-20]} zoom={4}
            style={{height:520,width:"100%",background:"#060D1A"}} zoomControl attributionControl>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OSM &copy; CARTO' />
            <TileLayer url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png" attribution='&copy; OpenSeaMap' opacity={0.65} />
            <CaptureMap mapRef={mapRef} />
            {showGrid && marineGrid && <MeteoCanvasOverlay marineGrid={marineGrid} atmoGrid={showAtmo?atmoGrid:null}
              physicsGrid={showCurrents?physicsGrid:null} mode={gridMode}
              shipParams={{Tr:shipParams?.Tr||14,speed:voyageSpeed,heading:0,Lwl:shipParams?.Lwl||200}} hourIdx={chartHourIdx} />}
            {route && <FitBounds waypoints={route.waypoints} />}
            {voyageWeather?.length > 1 && voyageWeather.slice(0,-1).map((pt,i)=>(
              <Polyline key={`seg-${i}`} positions={[[pt.lat,pt.lon],[voyageWeather[i+1].lat,voyageWeather[i+1].lon]]}
                pathOptions={{color:riskColor(pt.riskSeverity),weight:hoveredRouteIdx===i?7:5,opacity:0.9}}
                eventHandlers={{
                  mouseover: () => setHoveredRouteIdx(i),
                  mouseout: () => setHoveredRouteIdx(null),
                }} />
            ))}
            {route && !voyageWeather && <Polyline positions={route.waypoints.map(w=>[w.lat,w.lon])}
              pathOptions={{color:"#F59E0B",weight:3,opacity:0.85,dashArray:"8,6"}} />}

            {/* Ship position — driven by forecast scrubber when chart loaded, else real-time */}
            {(() => {
              const firstResult = marineGrid?.results?.find(r => r.times?.length > 0);
              const baseMs = firstResult ? firstResult.times[0]*1000 : Date.now();
              const chartTimeMs = baseMs + chartHourIdx * 3600000;
              const chartShipPos = (showGrid && marineGrid && voyageWPs?.length) ? calcCurrentPosition(voyageWPs, chartTimeMs) : null;
              const chartShipWx = chartShipPos?.status === "underway" && voyageWeather?.length
                ? voyageWeather.reduce((best, p) => { const d=Math.hypot(p.lat-chartShipPos.lat,p.lon-chartShipPos.lon);
                    const db=Math.hypot(best.lat-chartShipPos.lat,best.lon-chartShipPos.lon); return d<db?p:best; })?.weather ?? null : null;
              const displayPos = chartShipPos ?? shipPos;
              return displayPos?.status === "underway" ? <ShipPositionLayer pos={displayPos} weather={chartShipPos ? chartShipWx : shipWx} /> : null;
            })()}

            {/* Draggable waypoint overlays removed — markers below are natively draggable */}

            {/* BOSP marker — draggable */}
            {route && <Marker position={[route.waypoints[0].lat,route.waypoints[0].lon]} icon={bospIcon} draggable={true}
              eventHandlers={{ dragend: e => { const {lat,lng}=e.target.getLatLng(); wpMove(0,parseFloat(lat.toFixed(5)),parseFloat(lng.toFixed(5))); } }}>
              <Tooltip direction="top" offset={[0,-18]} permanent><b style={{fontFamily:"'JetBrains Mono',monospace"}}>BOSP</b></Tooltip>
              <Popup><WpPopup wp={{...route.waypoints[0],...(voyageWPs?.[0]||{}),
                weather:voyageWeather?.find(p=>Math.abs(p.lat-route.waypoints[0].lat)<0.1)?.weather||null}} shipParams={shipParams}/></Popup>
            </Marker>}

            {/* EOSP marker */}
            {route && route.waypoints.length>1 && (() => {
              const last=route.waypoints[route.waypoints.length-1]; const lastVW=voyageWPs?.[voyageWPs.length-1]; const lastWeather=voyageWeather?.[voyageWeather.length-1];
              return (<Marker position={[last.lat,last.lon]} icon={eospIcon} draggable={true}
                eventHandlers={{ dragend: e => { const {lat,lng}=e.target.getLatLng(); wpMove(route.waypoints.length-1,parseFloat(lat.toFixed(5)),parseFloat(lng.toFixed(5))); } }}>
                <Tooltip direction="top" offset={[0,-18]} permanent>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10}}><b>EOSP</b>{lastVW&&<><br/>{new Date(lastVW.etaMs).toUTCString().slice(5,22)}</>}</div>
                </Tooltip>
                <Popup><WpPopup wp={{...last,...(lastVW||{}),weather:lastWeather?.weather||null}} shipParams={shipParams}/></Popup>
              </Marker>);
            })()}

            {/* Intermediate waypoints */}
            {route && route.waypoints.slice(1,-1).map((wp,i)=>{
              const vwp=voyageWPs?.[i+1]; const nearWx=voyageWeather?.find(p=>Math.abs(p.lat-wp.lat)<0.5&&Math.abs(p.lon-wp.lon)<0.5); const sev=nearWx?.riskSeverity??0;
              return (<Marker key={wp.id} position={[wp.lat,wp.lon]} icon={riskIcon(sev,i+2)} draggable={true}
                eventHandlers={{ dragend: e => { const {lat,lng}=e.target.getLatLng(); wpMove(i+1,parseFloat(lat.toFixed(5)),parseFloat(lng.toFixed(5))); } }}>
                {route.waypoints.length<=20&&<Tooltip direction="top" offset={[0,-14]} permanent>
                  <span style={{fontSize:9,fontFamily:"'JetBrains Mono',monospace"}}>{wp.name||`WP${i+2}`}</span></Tooltip>}
                <Popup><WpPopup wp={{...wp,...(vwp||{}),weather:nearWx?.weather||null,motions:nearWx?.motions||null,motionStatus:nearWx?.motionStatus||null}} shipParams={shipParams}/></Popup>
              </Marker>);
            })}
          </MapContainer>
        </div>

        {/* Forecast scrubber — below the synoptic chart */}
        <ForecastScrubber marineGrid={marineGrid} chartHourIdx={chartHourIdx} setChartHourIdx={setChartHourIdx}
          stepSize={stepSize} setStepSize={setStepSize} playing={playing} setPlaying={setPlaying}
          playSpeed={playSpeed} setPlaySpeed={setPlaySpeed} maxHourIdx={maxHourIdx}
          lastFetchSrc={lastFetchSrc} gridFetchedAt={gridFetchedAt} />

        {/* Polar Diagram — always shown when voyage weather available */}
        {voyageWeather?.length > 0 && (() => { try {
          // Compute scrubber-driven position when synoptic chart is loaded
          const firstResult = marineGrid?.results?.find(r => r.times?.length > 0);
          const baseMs = firstResult ? (firstResult.times[0] < 1e12 ? firstResult.times[0] * 1000 : firstResult.times[0]) : null;
          const chartTimeMs = baseMs ? baseMs + chartHourIdx * 3600000 : null;
          let polarPos = (chartTimeMs && voyageWPs?.length)
            ? calcCurrentPosition(voyageWPs, chartTimeMs) : shipPos;

          // Fall back: if no underway position, use first voyage weather point
          if (!polarPos || polarPos.status !== "underway") {
            const firstPt = voyageWeather[0];
            if (firstPt?.lat == null || firstPt?.lon == null) return null;
            const hdg = voyageWeather.length > 1 && voyageWeather[1]?.lat != null
              ? ((Math.atan2(voyageWeather[1].lon - firstPt.lon, voyageWeather[1].lat - firstPt.lat) * 180 / Math.PI) + 360) % 360
              : 270;
            polarPos = { status: "underway", lat: firstPt.lat, lon: firstPt.lon,
              heading: isFinite(hdg) ? hdg : 270, cog: isFinite(hdg) ? hdg : 270, cumNM: 0, elapsed_h: 0 };
          }

          // Find nearest voyage weather point to polar position
          const nearestVW = voyageWeather?.length
            ? voyageWeather.reduce((best, p) => {
                const d = Math.hypot(p.lat - polarPos.lat, p.lon - polarPos.lon);
                const db = Math.hypot(best.lat - polarPos.lat, best.lon - polarPos.lon);
                return d < db ? p : best;
              }) : null;
          const polarWx = nearestVW?.weather ?? shipWx;
          const polarMotion = nearestVW?.motions ?? shipMotion;
          const polarMStat = nearestVW?.motionStatus ?? shipMStat;

          return (
          <div style={{background:panelBg,borderRadius:8,padding:16,border:"1px solid #7C3AED50"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div>
                <div style={{color:"#A78BFA",fontSize:12,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>
                  🎯 Synoptic Polar Risk Diagram — Parametric &amp; Synchronous Rolling</div>
                <div style={{color:"#64748B",fontSize:10,marginTop:3}}>
                  Thermal heatmap: combined parametric (Tr≈2Te) + synchronous (Tr≈Te) risk &nbsp;|&nbsp;
                  Tw = {polarWx?.wavePeriod?.toFixed(1)||"—"}s &nbsp;·&nbsp;
                  Hs = {polarWx?.waveHeight?.toFixed(1)||"—"}m &nbsp;·&nbsp;
                  Tᵣ = {(shipParams?.Tr||14).toFixed(1)}s</div>
              </div>
              <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>
                <div style={{color:"#22D3EE"}}>{fmtLat(polarPos.lat)} &nbsp; {fmtLon(polarPos.lon)}</div>
                <div style={{color:"#94A3B8"}}>Hdg: {(polarPos.heading||0).toFixed(0)}°T &nbsp; COG: {(polarPos.cog||0).toFixed(0)}°T</div>
                {chartTimeMs && <div style={{color:"#F59E0B",fontSize:9}}>+{chartHourIdx}h — {new Date(chartTimeMs).toUTCString().slice(5,22)}</div>}
              </div>
            </div>
            {/* ── Polar diagram centred, full available width ── */}
            <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
              <ShipPolarDiagram pos={polarPos} weather={polarWx} shipParams={shipParams} />
            </div>

            {/* ── Data panels in compact 3-column grid below ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {/* Navigation */}
              <div style={{padding:10,background:"#0F172A",borderRadius:6,border:"1px solid #334155"}}>
                <div style={{color:"#F59E0B",fontSize:9,fontWeight:700,letterSpacing:"0.1em",marginBottom:6,textTransform:"uppercase"}}>Navigation</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>
                  <div><div style={{color:"#64748B",fontSize:8}}>Heading</div><div style={{color:"#22D3EE",fontWeight:700}}>{(polarPos.heading||0).toFixed(0)}°T</div></div>
                  <div><div style={{color:"#64748B",fontSize:8}}>COG</div><div style={{color:"#3B82F6",fontWeight:700}}>{(polarPos.cog||0).toFixed(0)}°T</div></div>
                  <div><div style={{color:"#64748B",fontSize:8}}>Speed</div><div style={{color:"#E2E8F0",fontWeight:700}}>{shipParams?.speed||"\u2014"} kts</div></div>
                  <div><div style={{color:"#64748B",fontSize:8}}>Rel. Wave</div><div style={{color:"#94A3B8",fontWeight:700}}>{(((polarWx?.waveDir||0)-(polarPos?.heading||0)+360)%360).toFixed(0)}°</div></div>
                </div>
              </div>

              {/* Sea / Swell / Wind / Current */}
              <div style={{background:"#0F172A",borderRadius:6,border:"1px solid #334155",overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,fontFamily:"'JetBrains Mono',monospace"}}>
                  <thead><tr style={{background:"#1E293B"}}>
                    <th style={{padding:"3px 5px",textAlign:"left",color:"#64748B",fontSize:8}}></th>
                    <th style={{padding:"3px 5px",textAlign:"right",color:"#EF4444",fontSize:8,fontWeight:700}}>SEA</th>
                    <th style={{padding:"3px 5px",textAlign:"right",color:"#22C55E",fontSize:8,fontWeight:700}}>SWELL</th>
                  </tr></thead>
                  <tbody>
                    <tr style={{borderBottom:"1px solid #1E293B"}}><td style={{padding:"2px 5px",color:"#64748B"}}>Hs (m)</td>
                      <td style={{padding:"2px 5px",textAlign:"right",color:"#EF4444",fontWeight:700}}>{polarWx?.waveHeight?.toFixed(1)||"\u2014"}</td>
                      <td style={{padding:"2px 5px",textAlign:"right",color:"#22C55E",fontWeight:700}}>{polarWx?.swellHeight?.toFixed(1)||"\u2014"}</td></tr>
                    <tr style={{borderBottom:"1px solid #1E293B"}}><td style={{padding:"2px 5px",color:"#64748B"}}>Dir (°T)</td>
                      <td style={{padding:"2px 5px",textAlign:"right",color:"#EF4444",fontWeight:700}}>{polarWx?.waveDir?.toFixed(0)||"\u2014"}</td>
                      <td style={{padding:"2px 5px",textAlign:"right",color:"#22C55E",fontWeight:700}}>{polarWx?.swellDir?.toFixed(0)||"\u2014"}</td></tr>
                    <tr style={{borderBottom:"1px solid #1E293B"}}><td style={{padding:"2px 5px",color:"#64748B"}}>Tp (s)</td>
                      <td style={{padding:"2px 5px",textAlign:"right",color:"#EF4444",fontWeight:700}}>{polarWx?.wavePeriod?.toFixed(1)||"\u2014"}</td>
                      <td style={{padding:"2px 5px",textAlign:"right",color:"#22C55E",fontWeight:700}}>{polarWx?.swellPeriod?.toFixed(1)||"\u2014"}</td></tr>
                    <tr style={{borderBottom:"1px solid #1E293B"}}><td style={{padding:"2px 5px",color:"#64748B"}}>Wind</td>
                      <td colSpan={2} style={{padding:"2px 5px",textAlign:"right",color:"#E2E8F0",fontWeight:700}}>{polarWx?.windKts?.toFixed(0)||"\u2014"} kts from {polarWx?.windDir?.toFixed(0)||"\u2014"}°T</td></tr>
                    {polarWx?.currentSpeed > 0 && <tr><td style={{padding:"2px 5px",color:"#64748B"}}>Current</td>
                      <td colSpan={2} style={{padding:"2px 5px",textAlign:"right",color:"#FACC15",fontWeight:700}}>{polarWx.currentSpeed?.toFixed(1)||"\u2014"} kts → {polarWx.currentDir?.toFixed(0)||"\u2014"}°T</td></tr>}
                  </tbody>
                </table>
              </div>

              {/* Motions + Reading */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {polarMotion && <div style={{padding:10,background:"#0F172A",borderRadius:6,border:`1px solid ${polarMStat?.color||"#334155"}50`,flex:1}}>
                  <div style={{color:polarMStat?.color||"#F59E0B",fontSize:11,fontWeight:800,marginBottom:6}}>{polarMStat?.label||"\u2014"}</div>
                  {[{l:"Roll",v:`${polarMotion.roll?.toFixed(1)??"\u2014"}°`,a:(polarMotion.roll||0)>=25},
                    {l:"Pitch",v:`${polarMotion.pitch?.toFixed(1)??"\u2014"}°`,a:(polarMotion.pitch||0)>=8},
                    {l:"Bridge acc",v:`${polarMotion.bridgeAcc?.toFixed(2)??"\u2014"} m/s²`,a:(polarMotion.bridgeAcc||0)>=2.94},
                    {l:"Slam prob",v:`${((polarMotion.slam??0)*100).toFixed(1)}%`,a:(polarMotion.slam||0)>=0.1},
                    {l:"Param risk",v:`${((polarMotion.paramRisk??0)*100).toFixed(0)}%`,a:(polarMotion.paramRisk||0)>=0.5},
                  ].map(({l,v,a})=>(<div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:2,fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>
                    <span style={{color:"#64748B"}}>{l}</span><span style={{color:a?"#EF4444":"#E2E8F0",fontWeight:a?800:400}}>{v}</span></div>))}
                </div>}
                <div style={{padding:8,background:"#0F172A",borderRadius:6,border:"1px solid #334155",fontSize:8,color:"#475569",lineHeight:1.5,fontFamily:"'JetBrains Mono',monospace"}}>
                  <b style={{color:"#64748B"}}>Reading:</b> Red zones = Tᵣ ≈ 2Tₑ (resonance). Keep heading away from red sectors.</div>
              </div>
            </div>
          </div>
          );
        } catch(e) { console.warn("[Polar] render error:", e.message); return null; } })()}

        <VoyageRiskTimeline voyageWeather={voyageWeather} voyageWPs={voyageWPs}
          bospDT={bospDT} maxRisk={maxRisk} voyageDaysStr={voyageDaysStr} />

        <RouteRiskScan voyageWeather={voyageWeather} voyageWPs={voyageWPs}
          shipParams={shipParams} voyageSpeed={voyageSpeed} />

        {/* Route Stats (no weather) */}
        {route && !voyageWeather && routeStats && (
          <div style={{background:panelBg,borderRadius:8,padding:"12px 16px",border:"1px solid #334155"}}>
            {SH("Route Info")}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,fontSize:11}}>
              <div><span style={{color:"#64748B"}}>Waypoints: </span><b style={{color:"#F59E0B"}}>{route.waypoints.length}</b></div>
              <div><span style={{color:"#64748B"}}>Distance: </span><b style={{color:"#3B82F6"}}>{(routeStats.totalNM||0).toFixed(0)} NM</b></div>
              <div><span style={{color:"#64748B"}}>ETA: </span><b style={{color:"#DC2626"}}>{voyageDaysStr} d</b></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
