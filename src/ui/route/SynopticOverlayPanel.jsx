// ─── SynopticOverlayPanel — synoptic chart overlay controls ──────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2
import { SH, Panel, btnSt, inputSt, lblSt, riskColor } from "./shared.jsx";
import { getColorLegend } from "../../MeteoOverlay.jsx";
import { cacheClearAll } from "../../weatherCache.js";

export default function SynopticOverlayPanel({
  gridRes, setGridRes, gridMode, setGridMode, showAtmo, setShowAtmo,
  showGrid, setShowGrid, fetchSeaOverlay, anyLoading, gridLoading,
  gridProgress, gridError, marineGrid, maxHourIdx,
  lastFetchSrc, cacheInfo, setCacheInfo,
}) {
  return (
    <Panel>
      {SH("\ud83d\uddfa Synoptic Chart Overlay")}
      <div style={{color:"#94A3B8",fontSize:10,lineHeight:1.5,marginBottom:8}}>
        Wave gradient {"\u00b7"} Isobars (4 hPa) {"\u00b7"} WMO Wind Barbs<br/>Pan/zoom to area of interest first.</div>
      <label style={lblSt}>Grid Resolution ({"\u00b0"})</label>
      <select value={gridRes} onChange={e=>setGridRes(parseFloat(e.target.value))} style={{...inputSt,marginBottom:8,cursor:"pointer"}}>
        <option value={1.0}>1.0{"\u00b0"} {"\u2014"} fine (slower)</option>
        <option value={2.0}>2.0{"\u00b0"} {"\u2014"} standard</option>
        <option value={3.0}>3.0{"\u00b0"} {"\u2014"} coarse (fast)</option>
        <option value={5.0}>5.0{"\u00b0"} {"\u2014"} overview</option>
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
      <div style={{color:"#475569",fontSize:9,padding:"6px 8px",background:"#0F172A80",borderRadius:3,marginBottom:6,lineHeight:1.5,border:"1px solid #33415550"}}>
        ℹ Use <b style={{color:"#F59E0B"}}>FETCH ROUTE WEATHER</b> in the left panel — fetches synoptic grid + voyage weather in one coherent action.
      </div>
      {gridError&&<div style={{color:"#EF4444",fontSize:10,marginTop:6}}>{gridError}</div>}
      {marineGrid&&<div style={{color:"#64748B",fontSize:9,marginTop:4}}>
        {marineGrid.results.length} pts {"\u00b7"} {maxHourIdx}h forecast &nbsp;{"\u00b7"}&nbsp;
        <span style={{color:lastFetchSrc==="cache"?"#22D3EE":"#16A34A"}}>
          {lastFetchSrc==="cache"?"\ud83d\udce6 cached":"\ud83c\udf10 fetched live"}</span> &nbsp;{"\u00b7"}&nbsp;
        <span style={{color:"#A78BFA"}}>
          {marineGrid.provider==="noaa_wwiii"?"\ud83d\udce1 NOAA WW3 0.5\u00b0"
            :marineGrid.results[0]?.source==="cmems"?"\ud83d\udef0 CMEMS 0.083\u00b0":"\ud83d\udce1 Open-Meteo 0.25\u00b0"}</span>
      </div>}
      {cacheInfo.length > 0 && (
        <div style={{marginTop:8,padding:6,background:"#0F172A",borderRadius:4,border:"1px solid #334155"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <span style={{color:"#64748B",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em"}}>{"\ud83d\udce6"} Cache</span>
            <button onClick={()=>{cacheClearAll();setCacheInfo([]);}}
              style={{...btnSt,padding:"2px 6px",fontSize:8,background:"#7F1D1D30",color:"#EF4444",border:"1px solid #EF444430"}}>CLEAR ALL</button>
          </div>
          {cacheInfo.map((e,i)=>(
            <div key={i} style={{fontSize:8,color:"#475569",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
              <span style={{color:e.staleInMin>60?"#16A34A":"#D97706"}}>{e.type}</span>
              &nbsp;{"\u00b7"} {e.pts} pts {"\u00b7"} age {e.ageMin}m {"\u00b7"} fresh for {e.staleInMin}m
            </div>
          ))}
        </div>
      )}
      <label style={{display:"flex",alignItems:"center",gap:6,marginTop:8,cursor:"pointer"}}>
        <input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)} style={{accentColor:"#F59E0B"}}/>
        <span style={{color:"#94A3B8",fontSize:11}}>Show overlay on chart</span>
      </label>
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
        </div>);})()}
    </Panel>
  );
}
