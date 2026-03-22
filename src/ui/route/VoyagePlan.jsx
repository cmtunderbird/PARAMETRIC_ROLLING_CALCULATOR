// ─── VoyagePlan — BOSP / EOSP voyage planning panel ─────────────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2
import { SH, Panel, btnSt, inputSt, lblSt } from "./shared.jsx";

export default function VoyagePlan({
  route, bospDT, setBospDT, voyageSpeed, setVoyageSpeed,
  calcVoyage, voyageWPs, eospStr, voyageDaysStr,
}) {
  if (!route) return null;
  return (
    <Panel>
      {SH("\u2693 Voyage Plan \u2014 BOSP / EOSP")}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div style={{gridColumn:"1/-1",padding:"6px 8px",background:"#0F172A",borderRadius:4,border:"1px solid #16A34A50"}}>
          <div style={{color:"#16A34A",fontSize:9,fontWeight:800,letterSpacing:"0.15em",marginBottom:2}}>{"\u25b6"} BOSP {"\u2014"} BEGIN OF SEA PASSAGE</div>
          <div style={{color:"#CBD5E1",fontSize:10,fontWeight:600}}>{route.waypoints[0]?.name||"WP 01"}</div>
        </div>
        <div style={{gridColumn:"1/-1",padding:"6px 8px",background:"#0F172A",borderRadius:4,border:"1px solid #DC262650"}}>
          <div style={{color:"#DC2626",fontSize:9,fontWeight:800,letterSpacing:"0.15em",marginBottom:2}}>{"\u25a0"} EOSP {"\u2014"} END OF SEA PASSAGE</div>
          <div style={{color:"#CBD5E1",fontSize:10,fontWeight:600}}>{route.waypoints[route.waypoints.length-1]?.name||`WP ${String(route.waypoints.length).padStart(2,"0")}`}</div>
        </div>
      </div>
      <label style={lblSt}>BOSP Departure (UTC)</label>
      <input type="datetime-local" value={bospDT} onChange={e=>setBospDT(e.target.value)} style={{...inputSt,marginBottom:8,colorScheme:"dark"}} />
      <label style={lblSt}>Vessel Speed (kts)</label>
      <input type="number" value={voyageSpeed} min={1} max={30} step={0.5} onChange={e=>setVoyageSpeed(parseFloat(e.target.value)||15)} style={{...inputSt,marginBottom:10}} />
      <button onClick={calcVoyage} style={{...btnSt,width:"100%",background:"linear-gradient(90deg,#3B82F6,#2563EB)",color:"#fff"}}>
        {"\ud83d\udccd"} CALCULATE VOYAGE ETAs</button>
      {voyageWPs && <div style={{marginTop:8,padding:"6px 8px",background:"#0F172A",borderRadius:4,fontSize:10}}>
        <div style={{color:"#64748B"}}>Total: <b style={{color:"#3B82F6"}}>{voyageWPs[voyageWPs.length-1]?.cumNM?.toFixed(0)||"\u2014"} NM</b></div>
        <div style={{color:"#64748B"}}>EOSP: <b style={{color:"#DC2626"}}>{eospStr}</b></div>
        <div style={{color:"#64748B"}}>Duration: <b style={{color:"#F59E0B"}}>{voyageDaysStr} days</b></div>
      </div>}
    </Panel>
  );
}
