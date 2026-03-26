// ─── VoyageRiskTimeline — bar chart of risk along voyage ──────────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2
import { riskColor, panelBg, SH } from "./shared.jsx";

export default function VoyageRiskTimeline({
  voyageWeather, voyageWPs, bospDT, maxRisk, voyageDaysStr,
}) {
  if (!voyageWeather?.length) return null;
  const maxWh = Math.max(...voyageWeather.map(p=>p.weather?.waveHeight||0),1);
  const eospMs = voyageWPs?.[voyageWPs.length-1]?.etaMs || new Date(bospDT + 'Z').getTime()+1;
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
      <div style={{display:"flex",gap:1,alignItems:"flex-end",height:72,overflowX:"auto"}}>
        {voyageWeather.map((pt,i)=>{
          const ht=Math.max(10,(pt.weather?.waveHeight||0)/maxWh*100);
          const lbl=pt.etaMs ? new Date(pt.etaMs).toUTCString().slice(5,11) : "";
          return (
            <div key={i} title={`${lbl} UTC\n${["MIN","LOW","MOD","ELEV","HIGH","CRIT","FORB"][pt.riskSeverity]} | Hs=${pt.weather?.waveHeight?.toFixed(1)||"?"}m | Tw=${pt.weather?.wavePeriod?.toFixed(1)||"?"}s`}
              style={{flex:"1 0 8px",minWidth:8,maxWidth:22,height:`${ht}%`,
                background:riskColor(pt.riskSeverity),borderRadius:"2px 2px 0 0",
                opacity:0.85,cursor:"pointer",transition:"opacity 0.15s"}}
              onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.85} />
          );
        })}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:9,color:"#64748B",fontFamily:"'JetBrains Mono',monospace"}}>
        <span>BOSP {new Date(bospDT + 'Z').toUTCString().slice(5,16)} UTC</span>
        <span style={{color:"#3B82F6"}}>{voyageWPs?.[voyageWPs.length-1]?.cumNM?.toFixed(0)||"\u2014"} NM</span>
        <span>EOSP {new Date(eospMs).toUTCString().slice(5,16)} UTC</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginTop:8}}>
        {[
          {label:"Max Hs",val:(Math.max(...voyageWeather.map(p=>p.weather?.waveHeight||0))).toFixed(1)+"m",c:"#3B82F6"},
          {label:"Max Roll",val:(Math.max(...voyageWeather.map(p=>p.motions?.roll||0))).toFixed(1)+"\u00b0",c:"#F59E0B"},
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
}
