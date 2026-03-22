// ─── WeatherProviderPanel — CMEMS provider configuration ─────────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2
import { SH, Panel, btnSt, inputSt, lblSt } from "./shared.jsx";
import { testCmemsConnection, saveCmemsCredentials, clearCmemsCredentials,
         CMEMS_WAVE_DATASET, CMEMS_PHYSICS_DATASET } from "../../cmemsProvider.js";

export default function WeatherProviderPanel({
  cmemsUser, setCmemsUser, cmemsPass, setCmemsPass,
  cmemsProvider, setCmemsProvider, cmemsCredentials,
  cmemsTestMsg, setCmemsTestMsg, cmemsTestOk, setCmemsTestOk,
  cmemsTestLoading, setCmemsTestLoading,
  showCurrents, setShowCurrents,
}) {
  return (
    <Panel>
      {SH("\ud83d\udef0 Weather Provider")}
      <div style={{display:"flex",gap:4,marginBottom:10}}>
        {[
          {key:"openmeteo", label:"Open-Meteo", desc:"Free \u00b7 GFS/ECMWF \u00b7 0.25\u00b0"},
          {key:"auto",      label:"Auto",        desc:"CMEMS if creds, else OM"},
          {key:"cmems",     label:"CMEMS",        desc:"0.083\u00b0 \u00b7 same as windmar"},
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
      <div style={{padding:"5px 8px",background:"#0F172A",borderRadius:4,border:"1px solid #334155",marginBottom:8,fontSize:9,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
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
      <label style={lblSt}>CMEMS Username <span style={{color:"#475569",fontSize:8}}>marine.copernicus.eu</span></label>
      <input value={cmemsUser} onChange={e=>{setCmemsUser(e.target.value);saveCmemsCredentials(e.target.value,cmemsPass);}}
        placeholder="your.email@example.com" autoComplete="username" style={{...inputSt,marginBottom:6}} />
      <label style={lblSt}>CMEMS Password</label>
      <input type="password" value={cmemsPass} onChange={e=>{setCmemsPass(e.target.value);saveCmemsCredentials(cmemsUser,e.target.value);}}
        placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autoComplete="current-password" style={{...inputSt,marginBottom:8}} />
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        <button onClick={async()=>{
          setCmemsTestLoading(true); setCmemsTestMsg(null);
          const r = await testCmemsConnection(cmemsUser, cmemsPass);
          setCmemsTestOk(r.ok); setCmemsTestMsg(r.message); setCmemsTestLoading(false);
        }} disabled={cmemsTestLoading||!cmemsUser||!cmemsPass}
          style={{...btnSt,flex:1,padding:"5px 8px",fontSize:10,
            background:"linear-gradient(90deg,#334155,#475569)",color:"#E2E8F0"}}>
          {cmemsTestLoading?"TESTING...":"\ud83d\udd0c TEST CONNECTION"}
        </button>
        <button onClick={()=>{clearCmemsCredentials();setCmemsUser("");setCmemsPass("");setCmemsTestMsg(null);}}
          style={{...btnSt,padding:"5px 8px",fontSize:10,background:"#0F172A",color:"#EF4444",border:"1px solid #EF444430"}}>{"\u2715"}</button>
      </div>
      {cmemsTestMsg && <div style={{fontSize:9,padding:"5px 8px",borderRadius:4,marginBottom:6,
        background:cmemsTestOk?"#16A34A20":"#DC262620",border:`1px solid ${cmemsTestOk?"#16A34A":"#DC2626"}40`,
        color:cmemsTestOk?"#86EFAC":"#FCA5A5",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.5}}>{cmemsTestMsg}</div>}
      {!cmemsUser && <div style={{fontSize:9,color:"#475569",lineHeight:1.5}}>
        Free account: <a href="https://data.marine.copernicus.eu/register" target="_blank" rel="noreferrer" style={{color:"#7C3AED"}}>data.marine.copernicus.eu/register</a>
        <br/>Requests route through the local Vite proxy {"\u2014"} no CORS issues.
      </div>}
      <label style={{display:"flex",alignItems:"center",gap:6,marginTop:4,cursor:"pointer"}}>
        <input type="checkbox" checked={showCurrents} onChange={e=>setShowCurrents(e.target.checked)} style={{accentColor:"#22D3EE"}}/>
        <span style={{color:"#94A3B8",fontSize:11}}>Show ocean currents (cyan arrows)</span>
      </label>
    </Panel>
  );
}
