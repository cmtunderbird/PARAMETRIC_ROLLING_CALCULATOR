// ─── RouteChart.jsx ───────────────────────────────────────────────────────────
// Route chart with:
//   • BOSP / EOSP departure & arrival time entry
//   • ETA calculation at every waypoint
//   • Time-aware weather: picks the forecast hour matching each waypoint's ETA
//   • Full seakeeping risk assessment (calcMotions) at every waypoint
//   • Route segments colour-coded by parametric rolling risk
//   • Synoptic chart overlay: wave gradient + isobars + WMO wind barbs
//   • 7-day forecast scrubber for the chart overlay
import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { autoDetectAndParse, computeRouteStats, generateWeatherSamplePoints,
         generateSampleRTZ } from "./RouteParser.js";
import MeteoCanvasOverlay, { getColorLegend } from "./MeteoOverlay.jsx";
import { buildGridPoints, fetchMarineGrid, fetchAtmosphericGrid,
         fetchMarineUnified, fetchCmemsPhysicsGrid,
         closestHourIdx, snapshotAt, calcVoyageETAs } from "./weatherApi.js";
import { cacheStatus, cacheClearAll, cacheInvalidate } from "./weatherCache.js";
import { testCmemsConnection, loadCmemsCredentials,
         saveCmemsCredentials, clearCmemsCredentials,
         CMEMS_WAVE_DATASET, CMEMS_PHYSICS_DATASET } from "./cmemsProvider.js";
import { calcMotions, getSafetyCostFactor, getMotionStatus,
         getRiskLevel, calcParametricRiskRatio, calcEncounterPeriod } from "./physics.js";
import { calcCurrentPosition, ShipPositionLayer,
         ShipPolarDiagram, ShipInfoPanel } from "./ShipDashboard.jsx";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const riskColor = s => ["#0D9488","#16A34A","#CA8A04","#D97706","#EA580C","#DC2626","#7C3AED"][Math.min(s,6)]||"#64748B";
const panelBg="#1E293B";
const inputSt={background:"#0F172A",border:"1px solid #334155",borderRadius:4,color:"#E2E8F0",
  padding:"6px 8px",fontSize:12,fontFamily:"'JetBrains Mono',monospace",width:"100%",boxSizing:"border-box",outline:"none"};
const btnSt={padding:"8px 16px",border:"none",borderRadius:4,fontWeight:800,fontSize:11,
  fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",letterSpacing:"0.08em",transition:"all 0.2s"};
const lblSt={color:"#94A3B8",fontSize:10,fontWeight:600,textTransform:"uppercase",
  letterSpacing:"0.1em",marginBottom:3,display:"block",fontFamily:"'JetBrains Mono',monospace"};
const SH = t => <div style={{color:"#F59E0B",fontSize:11,fontWeight:700,letterSpacing:"0.15em",
  textTransform:"uppercase",borderBottom:"1px solid #1E293B",paddingBottom:6,marginBottom:10,
  fontFamily:"'JetBrains Mono',monospace"}}>{t}</div>;
const Panel = ({children,style={}}) => <div style={{background:panelBg,borderRadius:8,
  padding:16,border:"1px solid #334155",...style}}>{children}</div>;

function FitBounds({waypoints}){
  const map=useMap();
  useEffect(()=>{
    if(waypoints.length>0){
      const b=L.latLngBounds(waypoints.map(w=>[w.lat,w.lon]));
      map.fitBounds(b,{padding:[40,40]});
    }
  },[waypoints,map]);
  return null;
}
function CaptureMap({mapRef}){const map=useMap();useEffect(()=>{mapRef.current=map;},[map,mapRef]);return null;}

// ─── Custom BOSP/EOSP marker icons ────────────────────────────────────────────
const makeWpIcon = (color, label, size=28) => L.divIcon({
  className:"", iconSize:[size,size], iconAnchor:[size/2,size/2],
  html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
    border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;
    font-size:${size<26?8:10}px;font-weight:900;color:#fff;
    font-family:'JetBrains Mono',monospace;box-shadow:0 2px 8px rgba(0,0,0,0.5)">${label}</div>`,
});
const bospIcon = makeWpIcon("#16A34A","▶",32);
const eospIcon = makeWpIcon("#DC2626","■",32);
const riskIcon = (severity, label) => makeWpIcon(riskColor(severity), label, 22);

// ─── Waypoint popup ──────────────────────────────────────────────────────────
function WpPopup({ wp, shipParams }) {
  const w = wp.weather;
  return (
    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,minWidth:200}}>
      <div style={{fontWeight:800,color:"#F59E0B",marginBottom:6,fontSize:13}}>{wp.name||`WP ${wp.id}`}</div>
      {wp.etaMs && <div style={{color:"#22D3EE",marginBottom:4}}>
        ETA: {new Date(wp.etaMs).toUTCString().slice(0,25)} UTC
      </div>}
      {wp.cumNM!=null && <div style={{color:"#94A3B8",marginBottom:6}}>Dist from BOSP: {wp.cumNM.toFixed(1)} NM</div>}
      {w ? <>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
          <div><span style={{color:"#64748B"}}>Hs:</span> <b style={{color:"#3B82F6"}}>{w.waveHeight?.toFixed(1)||"—"}m</b></div>
          <div><span style={{color:"#64748B"}}>Tw:</span> <b style={{color:"#3B82F6"}}>{w.wavePeriod?.toFixed(1)||"—"}s</b></div>
          <div><span style={{color:"#64748B"}}>Swell:</span> <b style={{color:"#F59E0B"}}>{w.swellHeight?.toFixed(1)||"—"}m/{w.swellPeriod?.toFixed(0)||"—"}s</b></div>
          <div><span style={{color:"#64748B"}}>WDir:</span> <b>{w.waveDir?.toFixed(0)||"—"}°T</b></div>
          {w.windKts!=null && <>
            <div><span style={{color:"#64748B"}}>Wind:</span> <b style={{color:"#22D3EE"}}>{w.windKts?.toFixed(0)} kts</b></div>
            <div><span style={{color:"#64748B"}}>From:</span> <b>{w.windDir?.toFixed(0)||"—"}°T</b></div>
          </>}
          {w.mslp!=null && <div style={{gridColumn:"1/-1"}}><span style={{color:"#64748B"}}>MSLP:</span> <b style={{color:"#A855F7"}}>{w.mslp?.toFixed(0)} hPa</b></div>}
        </div>
        {wp.motions && <>
          <div style={{marginTop:6,borderTop:"1px solid #334155",paddingTop:6}}>
            <div style={{color:wp.motionStatus?.color||"#94A3B8",fontWeight:800}}>{wp.motionStatus?.label||"—"}</div>
            <div>Roll: {wp.motions.roll?.toFixed(1)||"—"}° | Pitch: {wp.motions.pitch?.toFixed(1)||"—"}°</div>
            <div>Bridge: {wp.motions.bridgeAcc?.toFixed(2)||"—"} m/s² | Slam: {(wp.motions.slam*100).toFixed(0)||"—"}%</div>
            <div style={{color:"#94A3B8"}}>Param Risk: {(wp.motions.paramRisk*100).toFixed(0)||"—"}%</div>
          </div>
        </>}
      </> : <div style={{color:"#64748B",fontSize:10}}>No weather data — fetch voyage weather first</div>}
    </div>
  );
}

// ═══ Main component ═══════════════════════════════════════════════════════════
export default function RouteChart({ shipParams }) {
  const [route, setRoute]           = useState(null);
  const [routeStats, setRouteStats] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [fileName, setFileName]     = useState(null);

  // ── BOSP / EOSP ──
  const nowLocal = () => { const d=new Date(); d.setSeconds(0,0); return d.toISOString().slice(0,16); };
  const [bospDT, setBospDT]   = useState(nowLocal);   // datetime-local string
  const [voyageSpeed, setVoyageSpeed] = useState(shipParams?.speed||15);
  const [voyageWPs, setVoyageWPs]     = useState(null); // waypoints with ETA

  // ── Voyage weather (time-aware) ──
  const [voyageWeather, setVoyageWeather] = useState(null);
  const [vwLoading, setVwLoading]         = useState(false);
  const [vwError, setVwError]             = useState(null);

  // ── Sea chart overlay ──
  const [marineGrid, setMarineGrid] = useState(null);
  const [atmoGrid,   setAtmoGrid]   = useState(null);
  const [gridRes,    setGridRes]    = useState(2.0);
  const [gridMode,   setGridMode]   = useState("waveHeight");
  const [showGrid,   setShowGrid]   = useState(true);
  const [showAtmo,   setShowAtmo]   = useState(true);
  const [gridLoading,setGridLoading]= useState(false);
  const [gridError,  setGridError]  = useState(null);
  const [gridProgress, setGridProgress] = useState(null); // {step, done, total}

  // ── CMEMS provider state ──
  const [cmemsUser,      setCmemsUser]      = useState(() => loadCmemsCredentials().user);
  const [cmemsPass,      setCmemsPass]      = useState(() => loadCmemsCredentials().pass);
  const [cmemsProvider,  setCmemsProvider]  = useState("auto");   // "openmeteo" | "cmems" | "auto"
  const [cmemsTestMsg,   setCmemsTestMsg]   = useState(null);
  const [cmemsTestOk,    setCmemsTestOk]    = useState(null);
  const [cmemsTestLoading, setCmemsTestLoading] = useState(false);
  const [physicsGrid,    setPhysicsGrid]    = useState(null);      // CMEMS currents/SST
  const [showCurrents,   setShowCurrents]   = useState(true);
  const cmemsCredentials = cmemsUser && cmemsPass ? { user: cmemsUser, pass: cmemsPass } : null;
  const [chartHourIdx, setChartHourIdx] = useState(0); // forecast scrubber
  const [stepSize,     setStepSize]     = useState(6);  // 1 | 3 | 6 | 12
  const [playing,      setPlaying]      = useState(false);
  const [playSpeed,    setPlaySpeed]    = useState(600); // ms per step
  const [cacheInfo,    setCacheInfo]    = useState([]);
  const [lastFetchSrc, setLastFetchSrc] = useState(null); // "cache" | "network"
  const [gridFetchedAt, setGridFetchedAt] = useState(null);
  const playRef = useRef(null);

  const mapRef     = useRef(null);
  const fileRef    = useRef(null);
  const anyLoading = vwLoading||gridLoading;

  // ── Live ship position (updates every 30 s) ──
  const [shipPos,    setShipPos]    = useState(null);
  const [shipWx,     setShipWx]     = useState(null);
  const [shipMotion, setShipMotion] = useState(null);
  const [shipMStat,  setShipMStat]  = useState(null);
  const [showPolar,  setShowPolar]  = useState(false);

  // Recompute position whenever voyageWPs or voyageWeather changes, and every 30s
  useEffect(() => {
    function tick() {
      if (!voyageWPs?.length) return;
      const pos = calcCurrentPosition(voyageWPs);
      setShipPos(pos);
      if (pos?.status === "underway" && voyageWeather?.length) {
        // Find closest weather sample to current position
        const closest = voyageWeather.reduce((best, p) => {
          const d = Math.hypot(p.lat - pos.lat, p.lon - pos.lon);
          return d < Math.hypot(best.lat - pos.lat, best.lon - pos.lon) ? p : best;
        });
        setShipWx(closest.weather || null);
        setShipMotion(closest.motions || null);
        setShipMStat(closest.motionStatus || null);
      }
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [voyageWPs, voyageWeather]);

  // ── Total forecast hours available (needed by play effect below) ──
  const maxHourIdx = marineGrid?.results?.find(r=>r.times)?.times?.length ?? 168;

  // ── Auto-advance forecast scrubber ──
  useEffect(() => {
    if (playRef.current) clearInterval(playRef.current);
    if (!playing || !marineGrid) return;
    playRef.current = setInterval(() => {
      setChartHourIdx(prev => {
        const next = prev + stepSize;
        if (next >= maxHourIdx) { setPlaying(false); return maxHourIdx - 1; }
        return next;
      });
    }, playSpeed);
    return () => clearInterval(playRef.current);
  }, [playing, stepSize, playSpeed, marineGrid, maxHourIdx]);

  // ── Refresh cache status ──
  useEffect(() => { setCacheInfo(cacheStatus()); }, [marineGrid, atmoGrid]);

  useEffect(()=>{
    if(route?.waypoints){
      setRouteStats(computeRouteStats(route.waypoints));
      setVoyageWPs(null);
      setVoyageWeather(null);
      // Clear live position immediately — avoids showing stale data from previous route
      setShipPos(null);
      setShipWx(null);
      setShipMotion(null);
      setShipMStat(null);
    }
  },[route]);

  // ── File handling ──
  const handleFile = useCallback(file=>{
    setParseError(null); setFileName(file.name);
    const r=new FileReader();
    r.onload=e=>{ try{ setRoute(autoDetectAndParse(e.target.result,file.name)); } catch(err){ setParseError(err.message); setRoute(null); } };
    r.readAsText(file);
  },[]);

  const loadDemo = ()=>{ try{ setRoute(autoDetectAndParse(generateSampleRTZ(),"demo.rtz")); setFileName("N.Atlantic_Demo.rtz"); } catch(e){ setParseError(e.message); } };

  // ── Step 1: Calculate voyage ETAs ──
  const calcVoyage = () => {
    if (!route?.waypoints) return;
    const bospMs = new Date(bospDT).getTime();
    const wps = calcVoyageETAs(route.waypoints, bospMs, voyageSpeed);
    setVoyageWPs(wps);
    setVoyageWeather(null);
  };

  // ── Step 2: Fetch weather matched to each waypoint's ETA ──
  const fetchVoyageWeather = async () => {
    if (!voyageWPs?.length) return;
    setVwLoading(true); setVwError(null);
    try {
      // Sample points along route (every N NM)
      const pts = generateWeatherSamplePoints(route.waypoints, 150);
      // ETA-match: for sampled point i, linearly interpolate ETA from waypoints
      const totalNM = voyageWPs[voyageWPs.length-1].cumNM||1;
      const bospMs  = new Date(bospDT).getTime();
      const eospMs  = bospMs + (totalNM/voyageSpeed)*3600000;

      // For each sample point, estimate ETA proportionally by cumulative distance
      let cumDists = [0];
      for (let i=1;i<pts.length;i++){
        const pr=pts[i-1],cu=pts[i];
        const dLat=(cu.lat-pr.lat)*Math.PI/180, dLon=(cu.lon-pr.lon)*Math.PI/180;
        const a=Math.sin(dLat/2)**2+Math.cos(pr.lat*Math.PI/180)*Math.cos(cu.lat*Math.PI/180)*Math.sin(dLon/2)**2;
        cumDists.push(cumDists[i-1]+3440.065*2*Math.asin(Math.sqrt(a)));
      }
      const totalPtNM = cumDists[cumDists.length-1]||1;
      const ptsWithETA = pts.map((p,i)=>({ ...p, etaMs: bospMs+(cumDists[i]/totalPtNM)*(eospMs-bospMs) }));

      // Deduplicate to ~1° grid for fetch efficiency
      const uniq=[], seen=new Set();
      for (const p of ptsWithETA){ const k=`${p.lat.toFixed(1)},${p.lon.toFixed(1)}`; if(!seen.has(k)){seen.add(k);uniq.push(p);} }

      // Fetch 7-day forecasts — marine first, then atmospheric (sequential to avoid 429)
      const marineRaw = await fetchMarineUnified(uniq, 7, null, 2.0, cmemsProvider, cmemsCredentials);
      const atmoRaw   = await fetchAtmosphericGrid(uniq, 7, null, 2.0);
      const mResults  = Array.isArray(marineRaw) ? marineRaw : (marineRaw?.results ?? []);
      const aResults  = Array.isArray(atmoRaw)   ? atmoRaw   : (atmoRaw?.results   ?? []);
      const marineMap = new Map(mResults.map(r=>[`${r.lat.toFixed(1)},${r.lon.toFixed(1)}`,r]));
      const atmoMap   = new Map(aResults.map(r=>[`${r.lat.toFixed(1)},${r.lon.toFixed(1)}`,r]));

      const results = ptsWithETA.map(p=>{
        const key=`${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
        const mr=marineMap.get(key); const ar=atmoMap.get(key);
        const mIdx = mr ? closestHourIdx(mr.times, p.etaMs) : 0;
        const aIdx = ar ? closestHourIdx(ar.times, p.etaMs) : 0;
        const weather = mr ? {
          waveHeight:mr.waveHeight?.[mIdx], waveDir:mr.waveDir?.[mIdx], wavePeriod:mr.wavePeriod?.[mIdx],
          swellHeight:mr.swellHeight?.[mIdx], swellPeriod:mr.swellPeriod?.[mIdx], swellDir:mr.swellDir?.[mIdx],
          windKts:ar?.windKts?.[aIdx], windDir:ar?.windDir?.[aIdx], mslp:ar?.mslp?.[aIdx],
        } : null;
        const motions = weather ? calcMotions({
          waveHeight_m:weather.waveHeight||0, wavePeriod_s:weather.wavePeriod||8, waveDir_deg:weather.waveDir||p.heading||0,
          swellHeight_m:weather.swellHeight||0, swellPeriod_s:weather.swellPeriod||10, swellDir_deg:weather.swellDir||0,
          heading_deg:p.heading||0, speed_kts:voyageSpeed,
          Lwl:shipParams?.Lwl||200, B:shipParams?.B||32, GM:shipParams?.GM||2.5, Tr:shipParams?.Tr||14,
        }) : null;
        const motionStatus = motions ? getMotionStatus(motions,weather?.waveHeight||0,weather?.windKts||0) : null;
        const riskSeverity = motionStatus?.severity ?? 0;
        return { ...p, weather, motions, motionStatus, riskSeverity };
      });
      setVoyageWeather(results);
    } catch(e){ setVwError(e.message); }
    setVwLoading(false);
  };

  // ── Sea chart synoptic overlay ──
  const fetchSeaOverlay = async (forceRefresh = false) => {
    const map = mapRef.current; if (!map) return;
    setGridLoading(true); setGridError(null); setGridProgress(null);
    try {
      const b = map.getBounds();
      const bounds = { south:b.getSouth(), north:b.getNorth(), west:b.getWest(), east:b.getEast() };
      const { points, bounds:gb } = buildGridPoints(bounds, gridRes);
      if (points.length > 1500) throw new Error(`Grid too large (${points.length} pts). Zoom in or use coarser resolution.`);
      if (forceRefresh) {
        cacheInvalidate("marine", gb, gridRes); cacheInvalidate("atmo", gb, gridRes);
        cacheInvalidate("marine_cmems", gb, 0.083); cacheInvalidate("physics_cmems", gb, 0.083);
      }

      // ── Step 1: Marine (CMEMS or Open-Meteo) — sequential, NOT parallel ──
      setGridProgress({ step:"Marine waves", done:0, total: Math.ceil(points.length/10) });
      const mResult = await fetchMarineUnified(points, 7, gb, gridRes, cmemsProvider, cmemsCredentials,
        (done,total) => setGridProgress({ step:"Marine waves", done, total }));
      setMarineGrid({ results:mResult.results, gridRes, bounds:gb });
      setLastFetchSrc(mResult.fromCache ? "cache" : "network");
      setGridFetchedAt(mResult.fetchedAt);

      // ── Step 2: Atmospheric (GFS) — after marine completes ──
      if (showAtmo) {
        setGridProgress({ step:"GFS wind + MSLP", done:0, total: Math.ceil(points.length/10) });
        const aResult = await fetchAtmosphericGrid(points, 7, gb, gridRes,
          (done,total) => setGridProgress({ step:"GFS wind + MSLP", done, total }));
        setAtmoGrid({ results:aResult.results, gridRes, bounds:gb });
      } else { setAtmoGrid(null); }

      // ── Step 3: CMEMS Physics (currents + SST) — only if credentials present ──
      if (cmemsCredentials && showCurrents) {
        setGridProgress({ step:"CMEMS currents", done:0, total:1 });
        try {
          const phyResult = await fetchCmemsPhysicsGrid(
            cmemsCredentials.user, cmemsCredentials.pass, points, gb, 0.083);
          setPhysicsGrid({ results:phyResult.results, gridRes:0.083, bounds:gb });
        } catch(e) { console.warn("CMEMS physics failed:", e.message); }
      }

      setChartHourIdx(0); setPlaying(false);
      setCacheInfo(cacheStatus());
    } catch(e){ setGridError(e.message); }
    setGridLoading(false); setGridProgress(null);
  };

  // ── Computed voyage summary ──
  const eosp = voyageWPs?.[voyageWPs.length-1];
  const eospStr = eosp ? new Date(eosp.etaMs).toUTCString().slice(0,25)+' UTC' : '—';
  const voyageDaysStr = eosp ? ((eosp.etaMs - new Date(bospDT).getTime())/86400000).toFixed(1) : '—';

  // Max risk along voyage for header badge
  const maxRisk = voyageWeather ? Math.max(...voyageWeather.map(p=>p.riskSeverity)) : 0;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"grid",gridTemplateColumns:"310px 1fr",gap:16,minHeight:650}}>

      {/* ═══ LEFT PANEL ═══════════════════════════════════════════════════════ */}
      <div style={{display:"flex",flexDirection:"column",gap:12,overflowY:"auto",maxHeight:"85vh"}}>

        {/* Route Import */}
        <Panel>
          {SH("Route Import")}
          <div style={{color:"#94A3B8",fontSize:10,marginBottom:8,lineHeight:1.5}}>
            Drop/select route from ECDIS:<br/>
            <span style={{color:"#F59E0B"}}>RTZ</span> (Furuno, JRC, Transas) · <span style={{color:"#F59E0B"}}>CSV</span> · <span style={{color:"#F59E0B"}}>GeoJSON</span>
          </div>
          <div onDrop={e=>{e.preventDefault();e.dataTransfer?.files?.[0]&&handleFile(e.dataTransfer.files[0]);}}
            onDragOver={e=>e.preventDefault()} onClick={()=>fileRef.current?.click()}
            style={{border:"2px dashed #334155",borderRadius:6,padding:20,textAlign:"center",
              cursor:"pointer",background:"#0F172A"}}
            onDragEnter={e=>e.currentTarget.style.borderColor="#F59E0B"}
            onDragLeave={e=>e.currentTarget.style.borderColor="#334155"}>
            <div style={{fontSize:22,marginBottom:4}}>📂</div>
            <div style={{color:"#94A3B8",fontSize:11}}>{fileName||"Drop .rtz / .csv / .geojson"}</div>
            <div style={{color:"#64748B",fontSize:9,marginTop:3}}>or click to browse</div>
          </div>
          <input ref={fileRef} type="file" accept=".rtz,.csv,.txt,.geojson,.json" style={{display:"none"}}
            onChange={e=>e.target.files?.[0]&&handleFile(e.target.files[0])} />
          <button onClick={loadDemo} style={{...btnSt,width:"100%",marginTop:8,
            background:"linear-gradient(90deg,#334155,#475569)",color:"#E2E8F0"}}>
            ▶ DEMO — North Atlantic Westbound
          </button>
          {parseError&&<div style={{color:"#EF4444",fontSize:10,marginTop:6,padding:6,background:"#7F1D1D20",borderRadius:4}}>{parseError}</div>}
        </Panel>

        {/* BOSP / EOSP */}
        {route && <Panel>
          {SH("⚓ Voyage Plan — BOSP / EOSP")}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div style={{gridColumn:"1/-1",padding:"6px 8px",background:"#0F172A",borderRadius:4,border:"1px solid #16A34A50"}}>
              <div style={{color:"#16A34A",fontSize:9,fontWeight:800,letterSpacing:"0.15em",marginBottom:2}}>▶ BOSP — BEGIN OF SEA PASSAGE</div>
              <div style={{color:"#CBD5E1",fontSize:10,fontWeight:600}}>{route.waypoints[0]?.name||"WP 01"}</div>
            </div>
            <div style={{gridColumn:"1/-1",padding:"6px 8px",background:"#0F172A",borderRadius:4,border:"1px solid #DC262650"}}>
              <div style={{color:"#DC2626",fontSize:9,fontWeight:800,letterSpacing:"0.15em",marginBottom:2}}>■ EOSP — END OF SEA PASSAGE</div>
              <div style={{color:"#CBD5E1",fontSize:10,fontWeight:600}}>{route.waypoints[route.waypoints.length-1]?.name||`WP ${String(route.waypoints.length).padStart(2,"0")}`}</div>
            </div>
          </div>
          <label style={lblSt}>BOSP Departure (UTC)</label>
          <input type="datetime-local" value={bospDT} onChange={e=>setBospDT(e.target.value)} style={{...inputSt,marginBottom:8,colorScheme:"dark"}} />
          <label style={lblSt}>Vessel Speed (kts)</label>
          <input type="number" value={voyageSpeed} min={1} max={30} step={0.5} onChange={e=>setVoyageSpeed(parseFloat(e.target.value)||15)} style={{...inputSt,marginBottom:10}} />
          <button onClick={calcVoyage} style={{...btnSt,width:"100%",background:"linear-gradient(90deg,#3B82F6,#2563EB)",color:"#fff"}}>
            📍 CALCULATE VOYAGE ETAs
          </button>
          {voyageWPs && <div style={{marginTop:8,padding:"6px 8px",background:"#0F172A",borderRadius:4,fontSize:10}}>
            <div style={{color:"#64748B"}}>Total: <b style={{color:"#3B82F6"}}>{voyageWPs[voyageWPs.length-1]?.cumNM?.toFixed(0)||"—"} NM</b></div>
            <div style={{color:"#64748B"}}>EOSP: <b style={{color:"#DC2626"}}>{eospStr}</b></div>
            <div style={{color:"#64748B"}}>Duration: <b style={{color:"#F59E0B"}}>{voyageDaysStr} days</b></div>
          </div>}
        </Panel>}

        {/* Live Ship Position */}
        {voyageWPs && <Panel>
          {SH("⛵ Live Ship Position")}
          <ShipInfoPanel pos={shipPos} weather={shipWx} shipParams={shipParams}
            motions={shipMotion} motionStatus={shipMStat} />
          {shipPos?.status === "underway" && voyageWeather?.length > 0 && (
            <button onClick={() => setShowPolar(p => !p)}
              style={{...btnSt,width:"100%",marginTop:10,
                background:showPolar?"linear-gradient(90deg,#7C3AED,#6D28D9)":"linear-gradient(90deg,#334155,#475569)",
                color:"#E2E8F0"}}>
              {showPolar ? "▲ HIDE POLAR DIAGRAM" : "🎯 SHOW POLAR RISK DIAGRAM"}
            </button>
          )}
        </Panel>}

        {/* Voyage Weather Fetch */}
        {voyageWPs && <Panel>
          {SH("🌊 Fetch Voyage Weather")}
          <div style={{color:"#94A3B8",fontSize:10,lineHeight:1.5,marginBottom:8}}>
            Fetches 7-day forecasts and picks the correct hour at each waypoint's ETA time.
            Runs full seakeeping assessment at every sample point.
          </div>
          <button onClick={fetchVoyageWeather} disabled={anyLoading}
            style={{...btnSt,width:"100%",background:anyLoading?"#334155":"linear-gradient(90deg,#F59E0B,#D97706)",color:"#0F172A"}}>
            {vwLoading?"FETCHING...":"⟳ FETCH TIME-AWARE WEATHER"}
          </button>
          {vwError&&<div style={{color:"#EF4444",fontSize:10,marginTop:6}}>{vwError}</div>}
          {voyageWeather&&<div style={{color:"#64748B",fontSize:9,marginTop:4}}>
            {voyageWeather.length} points assessed · Max risk: <span style={{color:riskColor(maxRisk),fontWeight:800}}>{["MIN","LOW","MOD","ELEV","HIGH","CRIT","FORB"][maxRisk]}</span>
          </div>}
        </Panel>}

        {/* ── CMEMS Provider Configuration ── */}
        <Panel>
          {SH("🛰 Weather Provider")}
          {/* Provider selector */}
          <div style={{display:"flex",gap:4,marginBottom:10}}>
            {[
              {key:"openmeteo", label:"Open-Meteo", desc:"Free · GFS/ECMWF · 0.25°"},
              {key:"auto",      label:"Auto",        desc:"CMEMS if creds, else OM"},
              {key:"cmems",     label:"CMEMS",        desc:"0.083° · same as windmar"},
            ].map(({key,label,desc})=>(
              <button key={key} onClick={()=>setCmemsProvider(key)}
                style={{...btnSt,flex:1,padding:"5px 4px",fontSize:9,
                  background: cmemsProvider===key?"linear-gradient(90deg,#7C3AED,#6D28D9)":"#0F172A",
                  color: cmemsProvider===key?"#fff":"#94A3B8",
                  border:`1px solid ${cmemsProvider===key?"#7C3AED":"#334155"}`,
                  lineHeight:1.3,whiteSpace:"nowrap"}}>
                <div style={{fontWeight:800}}>{label}</div>
                <div style={{fontSize:8,opacity:.8}}>{desc}</div>
              </button>
            ))}
          </div>

          {/* Dataset info */}
          <div style={{padding:"5px 8px",background:"#0F172A",borderRadius:4,
            border:"1px solid #334155",marginBottom:8,fontSize:9,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
            <div style={{color:"#A78BFA",fontWeight:700,marginBottom:3}}>Active datasets</div>
            {(cmemsProvider==="cmems"||(cmemsProvider==="auto"&&cmemsCredentials)) ? <>
              <div><span style={{color:"#64748B"}}>Waves:</span> <span style={{color:"#22D3EE"}}>{CMEMS_WAVE_DATASET}</span></div>
              <div><span style={{color:"#64748B"}}>Physics:</span> <span style={{color:"#22D3EE"}}>{CMEMS_PHYSICS_DATASET}</span></div>
              <div><span style={{color:"#64748B"}}>Wind:</span> <span style={{color:"#94A3B8"}}>GFS via Open-Meteo (always)</span></div>
            </> : <>
              <div><span style={{color:"#64748B"}}>Waves:</span> <span style={{color:"#94A3B8"}}>Open-Meteo Marine (ECMWF WAM)</span></div>
              <div><span style={{color:"#64748B"}}>Wind:</span> <span style={{color:"#94A3B8"}}>Open-Meteo GFS Seamless</span></div>
              <div><span style={{color:"#64748B"}}>Currents:</span> <span style={{color:"#94A3B8"}}>Open-Meteo HYCOM proxy</span></div>
            </>}
          </div>

          {/* Credentials */}
          <label style={lblSt}>CMEMS Username <span style={{color:"#475569",fontSize:8}}>marine.copernicus.eu</span></label>
          <input value={cmemsUser} onChange={e=>{setCmemsUser(e.target.value);saveCmemsCredentials(e.target.value,cmemsPass);}}
            placeholder="your.email@example.com" autoComplete="username"
            style={{...inputSt,marginBottom:6}} />
          <label style={lblSt}>CMEMS Password</label>
          <input type="password" value={cmemsPass}
            onChange={e=>{setCmemsPass(e.target.value);saveCmemsCredentials(cmemsUser,e.target.value);}}
            placeholder="••••••••" autoComplete="current-password"
            style={{...inputSt,marginBottom:8}} />

          <div style={{display:"flex",gap:6,marginBottom:6}}>
            <button onClick={async()=>{
              setCmemsTestLoading(true); setCmemsTestMsg(null);
              const r = await testCmemsConnection(cmemsUser, cmemsPass);
              setCmemsTestOk(r.ok); setCmemsTestMsg(r.message); setCmemsTestLoading(false);
            }} disabled={cmemsTestLoading||!cmemsUser||!cmemsPass}
              style={{...btnSt,flex:1,padding:"5px 8px",fontSize:10,
                background:"linear-gradient(90deg,#334155,#475569)",color:"#E2E8F0"}}>
              {cmemsTestLoading?"TESTING...":"🔌 TEST CONNECTION"}
            </button>
            <button onClick={()=>{clearCmemsCredentials();setCmemsUser("");setCmemsPass("");setCmemsTestMsg(null);}}
              style={{...btnSt,padding:"5px 8px",fontSize:10,background:"#0F172A",
                color:"#EF4444",border:"1px solid #EF444430"}}>✕</button>
          </div>
          {cmemsTestMsg && <div style={{fontSize:9,padding:"5px 8px",borderRadius:4,marginBottom:6,
            background: cmemsTestOk?"#16A34A20":"#DC262620",
            border:`1px solid ${cmemsTestOk?"#16A34A":"#DC2626"}40`,
            color: cmemsTestOk?"#86EFAC":"#FCA5A5",
            fontFamily:"'JetBrains Mono',monospace",lineHeight:1.5}}>
            {cmemsTestMsg}
          </div>}
          {!cmemsUser && <div style={{fontSize:9,color:"#475569",lineHeight:1.5}}>
            Free account: <a href="https://data.marine.copernicus.eu/register"
              target="_blank" rel="noreferrer" style={{color:"#7C3AED"}}>data.marine.copernicus.eu/register</a>
            <br/>Requests route through the local Vite proxy — no CORS issues.
          </div>}

          <label style={{display:"flex",alignItems:"center",gap:6,marginTop:4,cursor:"pointer"}}>
            <input type="checkbox" checked={showCurrents} onChange={e=>setShowCurrents(e.target.checked)} style={{accentColor:"#22D3EE"}}/>
            <span style={{color:"#94A3B8",fontSize:11}}>Show ocean currents (cyan arrows)</span>
          </label>
        </Panel>

        {/* ── Sea Chart Overlay ── */}
        <Panel>
          {SH("🗺 Synoptic Chart Overlay")}
          <div style={{color:"#94A3B8",fontSize:10,lineHeight:1.5,marginBottom:8}}>
            Wave gradient · Isobars (4 hPa) · WMO Wind Barbs<br/>
            Pan/zoom to area of interest first.
          </div>
          <label style={lblSt}>Grid Resolution (°)</label>
          <select value={gridRes} onChange={e=>setGridRes(parseFloat(e.target.value))} style={{...inputSt,marginBottom:8,cursor:"pointer"}}>
            <option value={1.0}>1.0° — fine (slower)</option>
            <option value={2.0}>2.0° — standard</option>
            <option value={3.0}>3.0° — coarse (fast)</option>
            <option value={5.0}>5.0° — overview</option>
          </select>
          <label style={lblSt}>Overlay Layer</label>
          <select value={gridMode} onChange={e=>setGridMode(e.target.value)} style={{...inputSt,marginBottom:8,cursor:"pointer"}}>
            <option value="waveHeight">Wave Height (Hs)</option>
            <option value="wavePeriod">Wave Period (Tw)</option>
            <option value="risk">Parametric Roll Risk</option>
          </select>
          <label style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,cursor:"pointer"}}>
            <input type="checkbox" checked={showAtmo} onChange={e=>setShowAtmo(e.target.checked)} style={{accentColor:"#F59E0B"}}/>
            <span style={{color:"#94A3B8",fontSize:11}}>Isobars + Wind Barbs (atmospheric)</span>
          </label>
          <button onClick={()=>fetchSeaOverlay(false)} disabled={anyLoading}
            style={{...btnSt,width:"100%",background:anyLoading?"#334155":"linear-gradient(90deg,#22D3EE,#3B82F6)",color:"#0F172A"}}>
            {gridLoading ? (gridProgress ? `${gridProgress.step}…` : "STARTING…") : "🌀 FETCH SYNOPTIC CHART"}
          </button>
          {/* Progress bar */}
          {gridLoading && gridProgress && (
            <div style={{marginTop:4}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#64748B",marginBottom:2,fontFamily:"'JetBrains Mono',monospace"}}>
                <span>{gridProgress.step}</span>
                <span>{gridProgress.done}/{gridProgress.total} batches</span>
              </div>
              <div style={{background:"#0F172A",borderRadius:3,height:5,border:"1px solid #334155"}}>
                <div style={{height:"100%",borderRadius:3,transition:"width 0.3s",
                  background:"linear-gradient(90deg,#22D3EE,#3B82F6)",
                  width:`${gridProgress.total>0?(gridProgress.done/gridProgress.total)*100:0}%`}}/>
              </div>
            </div>
          )}
          <button onClick={()=>fetchSeaOverlay(true)} disabled={anyLoading}
            style={{...btnSt,width:"100%",marginTop:4,background:anyLoading?"#1E293B":"#1E293B",
              color:"#EF4444",border:"1px solid #EF444440",fontSize:10}}>
            🔄 FORCE REFRESH (bypass cache)
          </button>
          {gridError&&<div style={{color:"#EF4444",fontSize:10,marginTop:6}}>{gridError}</div>}
          {marineGrid&&<div style={{color:"#64748B",fontSize:9,marginTop:4}}>
            {marineGrid.results.length} pts · {maxHourIdx}h forecast &nbsp;·&nbsp;
            <span style={{color:lastFetchSrc==="cache"?"#22D3EE":"#16A34A"}}>
              {lastFetchSrc==="cache"?"📦 cached":"🌐 fetched live"}
            </span> &nbsp;·&nbsp;
            <span style={{color:"#A78BFA"}}>
              {marineGrid.results[0]?.source==="cmems"?"🛰 CMEMS 0.083°":"📡 Open-Meteo 0.25°"}
            </span>
          </div>}
          {/* Cache status */}
          {cacheInfo.length > 0 && (
            <div style={{marginTop:8,padding:6,background:"#0F172A",borderRadius:4,border:"1px solid #334155"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{color:"#64748B",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em"}}>📦 Cache</span>
                <button onClick={()=>{cacheClearAll();setCacheInfo([]);}}
                  style={{...btnSt,padding:"2px 6px",fontSize:8,background:"#7F1D1D30",color:"#EF4444",border:"1px solid #EF444430"}}>
                  CLEAR ALL
                </button>
              </div>
              {cacheInfo.map((e,i)=>(
                <div key={i} style={{fontSize:8,color:"#475569",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
                  <span style={{color:e.staleInMin>60?"#16A34A":"#D97706"}}>{e.type}</span>
                  &nbsp;· {e.pts} pts · age {e.ageMin}m · fresh for {e.staleInMin}m
                </div>
              ))}
            </div>
          )}
          <label style={{display:"flex",alignItems:"center",gap:6,marginTop:8,cursor:"pointer"}}>
            <input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)} style={{accentColor:"#F59E0B"}}/>
            <span style={{color:"#94A3B8",fontSize:11}}>Show overlay on chart</span>
          </label>
          {/* Legend */}
          {marineGrid&&showGrid&&(()=>{const lg=getColorLegend(gridMode);return(
            <div style={{marginTop:8,padding:8,background:"#0F172A",borderRadius:4,border:"1px solid #334155"}}>
              <div style={{color:"#64748B",fontSize:9,fontWeight:700,marginBottom:4}}>{lg.title}</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {lg.items.map(({label,color})=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:2}}>
                    <div style={{width:10,height:10,borderRadius:1,background:color}}/>
                    <span style={{fontSize:8,color:"#94A3B8"}}>{label}</span>
                  </div>))}
              </div>
            </div>
          );}
          )()}
        </Panel>

        {/* Waypoint ETA table */}
        {voyageWPs && <Panel style={{maxHeight:280,overflowY:"auto"}}>
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
                <td style={{padding:"2px 3px",borderBottom:"1px solid #1E293B",textAlign:"right",color:"#94A3B8",fontSize:8}}>
                  {new Date(wp.etaMs).toUTCString().slice(5,22)}
                </td>
              </tr>))}
            </tbody>
          </table>
        </Panel>}
      </div>

      {/* ═══ RIGHT PANEL: Chart + Timeline ══════════════════════════════════ */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>

        {/* ═══ Forecast Scrubber ═══════════════════════════════════════════ */}
        {marineGrid && (() => {
          const nowMs   = Date.now();
          const baseMs  = marineGrid.results.find(r=>r.times)?.[0] ? marineGrid.results.find(r=>r.times).times[0]*1000 : nowMs;
          const totalH  = maxHourIdx;
          const curDate = new Date(baseMs + chartHourIdx * 3600000);
          const nowIdx  = Math.round((nowMs - baseMs) / 3600000);
          const cacheAgeMin = gridFetchedAt ? Math.round((nowMs - gridFetchedAt) / 60000) : null;
          // Tick marks at every 24h
          const dayTicks = Array.from({length: Math.floor(totalH/24)+1}, (_,i) => i*24).filter(h => h < totalH);

          return (
            <div style={{background:panelBg,borderRadius:8,border:"1px solid #334155",padding:"10px 16px"}}>
              {/* Row 1: step selector + play controls + time display */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                {/* Step size */}
                <div style={{display:"flex",gap:2}}>
                  {[1,3,6,12].map(s=>(
                    <button key={s} onClick={()=>setStepSize(s)}
                      style={{...btnSt,padding:"4px 8px",fontSize:10,
                        background:stepSize===s?"#F59E0B":"#1E293B",
                        color:stepSize===s?"#0F172A":"#94A3B8",
                        border:`1px solid ${stepSize===s?"#F59E0B":"#334155"}`}}>
                      {s}h
                    </button>
                  ))}
                </div>

                {/* Prev step */}
                <button onClick={()=>{setPlaying(false);setChartHourIdx(i=>Math.max(0,i-stepSize));}}
                  style={{...btnSt,padding:"4px 10px",background:"#1E293B",color:"#E2E8F0",border:"1px solid #334155"}}>◀</button>

                {/* Play / Pause */}
                <button onClick={()=>setPlaying(p=>!p)}
                  style={{...btnSt,padding:"4px 14px",
                    background:playing?"linear-gradient(90deg,#DC2626,#B91C1C)":"linear-gradient(90deg,#16A34A,#15803D)",
                    color:"#fff"}}>
                  {playing ? "⏸ PAUSE" : "▶ PLAY"}
                </button>

                {/* Next step */}
                <button onClick={()=>{setPlaying(false);setChartHourIdx(i=>Math.min(maxHourIdx-1,i+stepSize));}}
                  style={{...btnSt,padding:"4px 10px",background:"#1E293B",color:"#E2E8F0",border:"1px solid #334155"}}>▶</button>

                {/* Jump to now */}
                <button onClick={()=>{setPlaying(false);setChartHourIdx(Math.max(0,Math.min(nowIdx,maxHourIdx-1)));}}
                  style={{...btnSt,padding:"4px 10px",background:"#1E293B",color:"#22D3EE",border:"1px solid #22D3EE50",fontSize:10}}>
                  ⊙ NOW
                </button>

                {/* Play speed */}
                <select value={playSpeed} onChange={e=>setPlaySpeed(parseInt(e.target.value))}
                  style={{...inputSt,width:"auto",padding:"3px 6px",fontSize:10,color:"#94A3B8"}}>
                  <option value={1200}>Slow</option>
                  <option value={600}>Normal</option>
                  <option value={250}>Fast</option>
                  <option value={80}>Turbo</option>
                </select>

                {/* Current time readout */}
                <div style={{marginLeft:"auto",textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>
                  <div style={{color:"#F59E0B",fontSize:13,fontWeight:800}}>
                    +{chartHourIdx}h &nbsp; {curDate.toUTCString().slice(5,22)} UTC
                  </div>
                  <div style={{color:"#64748B",fontSize:9}}>
                    Day {Math.floor(chartHourIdx/24)+1} of 7 &nbsp;·&nbsp; Step: {stepSize}h &nbsp;·&nbsp;
                    {cacheAgeMin!=null && <span style={{color:lastFetchSrc==="cache"?"#22D3EE":"#16A34A"}}>
                      {lastFetchSrc==="cache"?"📦 cached":"🌐 fetched"} {cacheAgeMin}m ago
                    </span>}
                  </div>
                </div>
              </div>

              {/* Row 2: slider with day tick marks */}
              <div style={{position:"relative",paddingBottom:18}}>
                <input type="range" min={0} max={maxHourIdx-1} step={stepSize} value={chartHourIdx}
                  onChange={e=>{setPlaying(false);setChartHourIdx(parseInt(e.target.value));}}
                  style={{width:"100%",accentColor:"#F59E0B",cursor:"pointer"}} />
                {/* "Now" marker */}
                {nowIdx >= 0 && nowIdx < maxHourIdx && (
                  <div style={{position:"absolute",left:`${(nowIdx/(maxHourIdx-1))*100}%`,
                    top:0,transform:"translateX(-50%)",pointerEvents:"none"}}>
                    <div style={{width:2,height:18,background:"#22D3EE",margin:"0 auto"}}/>
                  </div>
                )}
                {/* Day labels */}
                <div style={{position:"absolute",bottom:0,left:0,right:0,display:"flex",pointerEvents:"none"}}>
                  {dayTicks.map(h=>{
                    const pct = (h/(maxHourIdx-1))*100;
                    const d = new Date(baseMs + h*3600000);
                    return (
                      <div key={h} style={{position:"absolute",left:`${pct}%`,transform:"translateX(-50%)",
                        textAlign:"center",fontFamily:"'JetBrains Mono',monospace"}}>
                        <div style={{width:1,height:4,background:"#334155",margin:"0 auto"}}/>
                        <div style={{fontSize:8,color:"#475569",whiteSpace:"nowrap"}}>
                          {d.toUTCString().slice(5,11)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Map */}
        <div style={{background:panelBg,borderRadius:8,border:"1px solid #334155",overflow:"hidden",flex:1,minHeight:480,position:"relative"}}>
          <MapContainer center={route?[route.waypoints[0].lat,route.waypoints[0].lon]:[45,-20]} zoom={4}
            style={{height:"100%",width:"100%",background:"#060D1A"}} zoomControl attributionControl>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; OSM &copy; CARTO' />
            <TileLayer url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
              attribution='&copy; OpenSeaMap' opacity={0.65} />
            <CaptureMap mapRef={mapRef} />
            {/* Synoptic overlay */}
            {showGrid && marineGrid && (
              <MeteoCanvasOverlay
                marineGrid={marineGrid}
                atmoGrid={showAtmo ? atmoGrid : null}
                physicsGrid={showCurrents ? physicsGrid : null}
                mode={gridMode}
                shipParams={{Tr:shipParams?.Tr||14,speed:voyageSpeed,heading:0,Lwl:shipParams?.Lwl||200}}
                hourIdx={chartHourIdx}
              />
            )}
            {route && <FitBounds waypoints={route.waypoints} />}

            {/* Risk-coloured route segments (voyage weather loaded) */}
            {voyageWeather?.length > 1 && voyageWeather.slice(0,-1).map((pt,i)=>(
              <Polyline key={`seg-${i}`}
                positions={[[pt.lat,pt.lon],[voyageWeather[i+1].lat,voyageWeather[i+1].lon]]}
                pathOptions={{color:riskColor(pt.riskSeverity),weight:5,opacity:0.9}} />
            ))}
            {/* Base route line (no weather yet) */}
            {route && !voyageWeather && (
              <Polyline positions={route.waypoints.map(w=>[w.lat,w.lon])}
                pathOptions={{color:"#F59E0B",weight:3,opacity:0.85,dashArray:"8,6"}} />
            )}

            {/* Live ship position + vectors */}
            {shipPos?.status === "underway" && (
              <ShipPositionLayer pos={shipPos} weather={shipWx} />
            )}

            {/* BOSP marker */}
            {route && <Marker position={[route.waypoints[0].lat,route.waypoints[0].lon]} icon={bospIcon}>
              <Tooltip direction="top" offset={[0,-18]} permanent>
                <b style={{fontFamily:"'JetBrains Mono',monospace"}}>BOSP</b>
              </Tooltip>
              <Popup><WpPopup wp={{...route.waypoints[0],...(voyageWPs?.[0]||{}),
                weather:voyageWeather?.find(p=>Math.abs(p.lat-route.waypoints[0].lat)<0.1)?.weather||null}} shipParams={shipParams}/></Popup>
            </Marker>}

            {/* EOSP marker */}
            {route && route.waypoints.length>1 && (() => {
              const last=route.waypoints[route.waypoints.length-1];
              const lastVW=voyageWPs?.[voyageWPs.length-1];
              const lastWeather=voyageWeather?.[voyageWeather.length-1];
              return (
                <Marker position={[last.lat,last.lon]} icon={eospIcon}>
                  <Tooltip direction="top" offset={[0,-18]} permanent>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>
                      <b>EOSP</b>{lastVW&&<><br/>{new Date(lastVW.etaMs).toUTCString().slice(5,22)}</>}
                    </div>
                  </Tooltip>
                  <Popup><WpPopup wp={{...last,...(lastVW||{}),weather:lastWeather?.weather||null}} shipParams={shipParams}/></Popup>
                </Marker>
              );
            })()}

            {/* Intermediate waypoints */}
            {route && route.waypoints.slice(1,-1).map((wp,i)=>{
              const vwp=voyageWPs?.[i+1];
              const nearWx=voyageWeather?.find(p=>Math.abs(p.lat-wp.lat)<0.5&&Math.abs(p.lon-wp.lon)<0.5);
              const sev=nearWx?.riskSeverity??0;
              return (
                <Marker key={wp.id} position={[wp.lat,wp.lon]} icon={riskIcon(sev,i+2)}>
                  {route.waypoints.length<=20&&<Tooltip direction="top" offset={[0,-14]} permanent>
                    <span style={{fontSize:9,fontFamily:"'JetBrains Mono',monospace"}}>{wp.name||`WP${i+2}`}</span>
                  </Tooltip>}
                  <Popup><WpPopup wp={{...wp,...(vwp||{}),weather:nearWx?.weather||null,motions:nearWx?.motions||null,motionStatus:nearWx?.motionStatus||null}} shipParams={shipParams}/></Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        {/* ── Synoptic Polar Risk Diagram ── */}
        {showPolar && shipPos?.status === "underway" && (
          <div style={{background:panelBg,borderRadius:8,padding:16,border:"1px solid #7C3AED50"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div>
                <div style={{color:"#A78BFA",fontSize:12,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>
                  🎯 Synoptic Polar Risk Diagram — Parametric Rolling
                </div>
                <div style={{color:"#64748B",fontSize:10,marginTop:3}}>
                  Thermal heatmap: risk intensity across all headings × speeds &nbsp;|&nbsp;
                  Tw = {shipWx?.wavePeriod?.toFixed(1)||"—"}s &nbsp;·&nbsp;
                  Hs = {shipWx?.waveHeight?.toFixed(1)||"—"}m &nbsp;·&nbsp;
                  Tᵣ = {(shipParams?.Tr||14).toFixed(1)}s
                </div>
              </div>
              <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>
                <div style={{color:"#22D3EE"}}>Pos: {Math.abs(shipPos.lat).toFixed(3)}°{shipPos.lat>=0?"N":"S"} {Math.abs(shipPos.lon).toFixed(3)}°{shipPos.lon>=0?"E":"W"}</div>
                <div style={{color:"#94A3B8"}}>Hdg: {shipPos.heading.toFixed(0)}°T &nbsp; COG: {shipPos.cog.toFixed(0)}°T</div>
              </div>
            </div>
            <div style={{display:"flex",gap:20,alignItems:"flex-start",flexWrap:"wrap"}}>
              {/* Polar diagram */}
              <ShipPolarDiagram pos={shipPos} weather={shipWx} shipParams={shipParams} />
              {/* Right side: current state detail */}
              <div style={{flex:1,minWidth:220,display:"flex",flexDirection:"column",gap:10}}>
                <div style={{padding:12,background:"#0F172A",borderRadius:6,border:"1px solid #334155"}}>
                  <div style={{color:"#F59E0B",fontSize:10,fontWeight:700,letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase"}}>Current State</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
                    {[
                      {l:"Ship Heading",v:`${shipPos.heading.toFixed(0)}°T`,c:"#22D3EE"},
                      {l:"COG",v:`${shipPos.cog.toFixed(0)}°T`,c:"#3B82F6"},
                      {l:"Wave dir (FROM)",v:`${shipWx?.waveDir?.toFixed(0)||"—"}°T`,c:"#EF4444"},
                      {l:"Swell dir (FROM)",v:`${shipWx?.swellDir?.toFixed(0)||"—"}°T`,c:"#F59E0B"},
                      {l:"Wind dir (FROM)",v:`${shipWx?.windDir?.toFixed(0)||"—"}°T`,c:"#E2E8F0"},
                      {l:"Rel. Wave angle",v:`${(((shipWx?.waveDir||0)-(shipPos?.heading||0)+360)%360).toFixed(0)}°`,c:"#94A3B8"},
                    ].map(({l,v,c})=>(
                      <div key={l}><div style={{color:"#64748B",fontSize:9}}>{l}</div><div style={{color:c,fontWeight:700}}>{v}</div></div>
                    ))}
                  </div>
                </div>
                {shipMotion && <div style={{padding:12,background:"#0F172A",borderRadius:6,border:`1px solid ${shipMStat?.color||"#334155"}50`}}>
                  <div style={{color:shipMStat?.color||"#F59E0B",fontSize:12,fontWeight:800,marginBottom:8}}>{shipMStat?.label||"—"}</div>
                  {[
                    {l:"Roll amplitude",v:`${shipMotion.roll?.toFixed(1)}°`,alert:shipMotion.roll>=25},
                    {l:"Pitch amplitude",v:`${shipMotion.pitch?.toFixed(1)}°`,alert:shipMotion.pitch>=8},
                    {l:"Bridge accel",v:`${shipMotion.bridgeAcc?.toFixed(2)} m/s²`,alert:shipMotion.bridgeAcc>=2.94},
                    {l:"Slam probability",v:`${(shipMotion.slam*100).toFixed(1)}%`,alert:shipMotion.slam>=0.1},
                    {l:"Parametric risk",v:`${(shipMotion.paramRisk*100).toFixed(0)}%`,alert:shipMotion.paramRisk>=0.5},
                  ].map(({l,v,alert})=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:4,fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
                      <span style={{color:"#64748B"}}>{l}</span>
                      <span style={{color:alert?"#EF4444":"#E2E8F0",fontWeight:alert?800:400}}>{v}</span>
                    </div>
                  ))}
                </div>}
                <div style={{padding:10,background:"#0F172A",borderRadius:6,border:"1px solid #334155",fontSize:9,color:"#475569",lineHeight:1.6,fontFamily:"'JetBrains Mono',monospace"}}>
                  <b style={{color:"#64748B"}}>Reading:</b> Red zones = Tᵣ ≈ 2Tₑ (resonance).
                  Magenta ring = critical. The ─── red arc marks exact resonance heading
                  at each speed. Keep ship heading away from red sectors.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Voyage Risk Timeline ── */}
        {voyageWeather?.length > 0 && (() => {
          const maxWh = Math.max(...voyageWeather.map(p=>p.weather?.waveHeight||0),1);
          const totalMs = new Date(bospDT).getTime();
          const eospMs  = voyageWPs?.[voyageWPs.length-1]?.etaMs || totalMs+1;
          return (
            <div style={{background:panelBg,borderRadius:8,padding:"12px 16px",border:"1px solid #334155"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                {SH("Voyage Risk & Weather Profile")}
                <div style={{display:"flex",gap:8,flexShrink:0}}>
                  {[0,1,2,3,4,5].map(s=>(
                    <div key={s} style={{display:"flex",alignItems:"center",gap:3}}>
                      <div style={{width:8,height:8,borderRadius:1,background:riskColor(s)}}/>
                      <span style={{fontSize:8,color:"#94A3B8"}}>{["MIN","LOW","MOD","ELEV","HIGH","CRIT"][s]}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Bar chart */}
              <div style={{display:"flex",gap:1,alignItems:"flex-end",height:72,overflowX:"auto"}}>
                {voyageWeather.map((pt,i)=>{
                  const ht=Math.max(10,(pt.weather?.waveHeight||0)/maxWh*100);
                  const lbl=pt.etaMs ? new Date(pt.etaMs).toUTCString().slice(5,11) : "";
                  return (
                    <div key={i} title={`${lbl} UTC\n${["MIN","LOW","MOD","ELEV","HIGH","CRIT","FORB"][pt.riskSeverity]} | Hs=${pt.weather?.waveHeight?.toFixed(1)||"?"}m | Tw=${pt.weather?.wavePeriod?.toFixed(1)||"?"}s`}
                      style={{flex:"1 0 8px",minWidth:8,maxWidth:22,height:`${ht}%`,
                        background:riskColor(pt.riskSeverity),borderRadius:"2px 2px 0 0",
                        opacity:0.85,cursor:"pointer",transition:"opacity 0.15s"}}
                      onMouseEnter={e=>e.target.style.opacity=1}
                      onMouseLeave={e=>e.target.style.opacity=0.85} />
                  );
                })}
              </div>
              {/* Time axis */}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:9,color:"#64748B",fontFamily:"'JetBrains Mono',monospace"}}>
                <span>BOSP {new Date(bospDT).toUTCString().slice(5,16)} UTC</span>
                <span style={{color:"#3B82F6"}}>{voyageWPs?.[voyageWPs.length-1]?.cumNM?.toFixed(0)||"—"} NM</span>
                <span>EOSP {new Date(eospMs).toUTCString().slice(5,16)} UTC</span>
              </div>
              {/* Summary row */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:8}}>
                {[
                  {label:"Max Hs",val:(Math.max(...voyageWeather.map(p=>p.weather?.waveHeight||0))).toFixed(1)+"m",c:"#3B82F6"},
                  {label:"Max Roll",val:(Math.max(...voyageWeather.map(p=>p.motions?.roll||0))).toFixed(1)+"°",c:"#F59E0B"},
                  {label:"Max Risk",val:["MIN","LOW","MOD","ELEV","HIGH","CRIT","FORB"][maxRisk],c:riskColor(maxRisk)},
                  {label:"Duration",val:voyageDaysStr+" d",c:"#94A3B8"},
                ].map(({label,val,c})=>(
                  <div key={label} style={{textAlign:"center",background:"#0F172A",borderRadius:4,padding:"4px 0"}}>
                    <div style={{color:c,fontWeight:800,fontSize:13,fontFamily:"'JetBrains Mono',monospace"}}>{val}</div>
                    <div style={{color:"#64748B",fontSize:8,textTransform:"uppercase",letterSpacing:"0.1em"}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Route Stats (no weather yet) */}
        {route && !voyageWeather && routeStats && (
          <div style={{background:panelBg,borderRadius:8,padding:"12px 16px",border:"1px solid #334155"}}>
            {SH("Route Info")}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,fontSize:11}}>
              <div><span style={{color:"#64748B"}}>Waypoints: </span><b style={{color:"#F59E0B"}}>{route.waypoints.length}</b></div>
              <div><span style={{color:"#64748B"}}>Distance: </span><b style={{color:"#3B82F6"}}>{routeStats.totalNM.toFixed(0)} NM</b></div>
              <div><span style={{color:"#64748B"}}>ETA: </span><b style={{color:"#DC2626"}}>{voyageDaysStr} d</b></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
