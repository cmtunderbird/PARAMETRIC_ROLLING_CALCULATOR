// ─── ForecastScrubber — forecast timeline player controls ────────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2
import { panelBg, btnSt, inputSt } from "./shared.jsx";

export default function ForecastScrubber({
  marineGrid, chartHourIdx, setChartHourIdx, stepSize, setStepSize,
  playing, setPlaying, playSpeed, setPlaySpeed, maxHourIdx,
  lastFetchSrc, gridFetchedAt,
}) {
  if (!marineGrid) return null;
  const nowMs = Date.now();
  const firstResult = marineGrid.results.find(r => r.times?.length > 0);
  const baseMs = firstResult ? firstResult.times[0] * 1000 : nowMs;
  const totalH = maxHourIdx;
  const curDate = new Date(baseMs + chartHourIdx * 3600000);
  const nowIdx = Math.round((nowMs - baseMs) / 3600000);
  const cacheAgeMin = gridFetchedAt ? Math.round((nowMs - gridFetchedAt) / 60000) : null;
  const dayTicks = Array.from({length: Math.floor(totalH/24)+1}, (_,i) => i*24).filter(h => h < totalH);

  return (
    <div style={{background:panelBg,borderRadius:8,border:"1px solid #334155",padding:"10px 16px"}}>
      {/* Row 1: step selector + play controls + time display */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:2}}>
          {[1,3,6,12].map(s=>(
            <button key={s} onClick={()=>setStepSize(s)}
              style={{...btnSt,padding:"4px 8px",fontSize:10,
                background:stepSize===s?"#F59E0B":"#1E293B",
                color:stepSize===s?"#0F172A":"#94A3B8",
                border:`1px solid ${stepSize===s?"#F59E0B":"#334155"}`}}>{s}h</button>
          ))}
        </div>
        <button onClick={()=>{setPlaying(false);setChartHourIdx(i=>Math.max(0,i-stepSize));}}
          style={{...btnSt,padding:"4px 10px",background:"#1E293B",color:"#E2E8F0",border:"1px solid #334155"}}>{"\u25c0"}</button>
        <button onClick={()=>setPlaying(p=>!p)}
          style={{...btnSt,padding:"4px 14px",
            background:playing?"linear-gradient(90deg,#DC2626,#B91C1C)":"linear-gradient(90deg,#16A34A,#15803D)",
            color:"#fff"}}>{playing ? "\u23f8 PAUSE" : "\u25b6 PLAY"}</button>
        <button onClick={()=>{setPlaying(false);setChartHourIdx(i=>Math.min(maxHourIdx-1,i+stepSize));}}
          style={{...btnSt,padding:"4px 10px",background:"#1E293B",color:"#E2E8F0",border:"1px solid #334155"}}>{"\u25b6"}</button>
        <button onClick={()=>{setPlaying(false);setChartHourIdx(Math.max(0,Math.min(nowIdx,maxHourIdx-1)));}}
          style={{...btnSt,padding:"4px 10px",background:"#1E293B",color:"#22D3EE",border:"1px solid #22D3EE50",fontSize:10}}>
          {"\u2299"} NOW</button>
        <select value={playSpeed} onChange={e=>setPlaySpeed(parseInt(e.target.value))}
          style={{...inputSt,width:"auto",padding:"3px 6px",fontSize:10,color:"#94A3B8"}}>
          <option value={1200}>Slow</option><option value={600}>Normal</option>
          <option value={250}>Fast</option><option value={80}>Turbo</option>
        </select>
        <div style={{marginLeft:"auto",textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>
          <div style={{color:"#F59E0B",fontSize:13,fontWeight:800}}>
            +{chartHourIdx}h &nbsp; {curDate.toUTCString().slice(5,22)} UTC
          </div>
          <div style={{color:"#64748B",fontSize:9}}>
            Day {Math.floor(chartHourIdx/24)+1} of 7 &nbsp;{"\u00b7"}&nbsp; Step: {stepSize}h &nbsp;{"\u00b7"}&nbsp;
            {cacheAgeMin!=null && <span style={{color:lastFetchSrc==="cache"?"#22D3EE":"#16A34A"}}>
              {lastFetchSrc==="cache"?"\ud83d\udce6 cached":"\ud83c\udf10 fetched"} {cacheAgeMin}m ago
            </span>}
          </div>
        </div>
      </div>
      {/* Row 2: slider with day tick marks */}
      <div style={{position:"relative",paddingBottom:18}}>
        <input type="range" min={0} max={maxHourIdx-1} step={stepSize} value={chartHourIdx}
          onChange={e=>{setPlaying(false);setChartHourIdx(parseInt(e.target.value));}}
          style={{width:"100%",accentColor:"#F59E0B",cursor:"pointer"}} />
        {nowIdx >= 0 && nowIdx < maxHourIdx && (
          <div style={{position:"absolute",left:`${(nowIdx/(maxHourIdx-1))*100}%`,
            top:0,transform:"translateX(-50%)",pointerEvents:"none"}}>
            <div style={{width:2,height:18,background:"#22D3EE",margin:"0 auto"}}/>
          </div>
        )}
        <div style={{position:"absolute",bottom:0,left:0,right:0,display:"flex",pointerEvents:"none"}}>
          {dayTicks.map(h=>{
            const pct = (h/(maxHourIdx-1))*100;
            const d = new Date(baseMs + h*3600000);
            return (
              <div key={h} style={{position:"absolute",left:`${pct}%`,transform:"translateX(-50%)",textAlign:"center",fontFamily:"'JetBrains Mono',monospace"}}>
                <div style={{width:1,height:4,background:"#334155",margin:"0 auto"}}/>
                <div style={{fontSize:8,color:"#475569",whiteSpace:"nowrap"}}>{d.toUTCString().slice(5,11)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
