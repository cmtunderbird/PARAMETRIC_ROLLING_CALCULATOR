// ─── VoyagePlan — BOSP / EOSP voyage planning panel ─────────────────────────
// Supports per-leg speeds and configurable BOSP/EOSP waypoint selection.
import { SH, Panel, btnSt, inputSt, lblSt } from "./shared.jsx";
import { fmtLat, fmtLon } from "../components/NauticalCoord.jsx";

export default function VoyagePlan({
  route, bospDT, setBospDT, voyageSpeed, setVoyageSpeed,
  bospIdx, setBospIdx, eospIdx, setEospIdx,
  legSpeeds, setLegSpeeds, calcVoyage, voyageWPs, eospStr, voyageDaysStr,
}) {
  if (!route) return null;
  const wps = route.waypoints;
  const ei = eospIdx ?? (wps.length - 1);

  const setLegSpeed = (idx, spd) => {
    setLegSpeeds(prev => {
      const next = { ...prev };
      if (spd === null || spd === voyageSpeed) { delete next[idx]; }
      else { next[idx] = spd; }
      return next;
    });
  };

  // Passage WPs = those between bospIdx and eospIdx inclusive
  const passageWPs = wps.slice(bospIdx, ei + 1);

  return (
    <Panel>
      {SH("\u2693 Voyage Plan \u2014 BOSP / EOSP")}

      {/* ── BOSP selector ── */}
      <div style={{marginBottom:8}}>
        <label style={{...lblSt,color:"#16A34A"}}>{"\u25b6"} BOSP {"\u2014"} Begin of Sea Passage</label>
        <select value={bospIdx} onChange={e => {
          const v = parseInt(e.target.value);
          setBospIdx(v);
          if (v >= ei) setEospIdx(wps.length - 1);
        }} style={{...inputSt,width:"100%",marginBottom:4,colorScheme:"dark"}}>
          {wps.map((wp, i) => i < ei && (
            <option key={i} value={i}>WP {i+1} — {wp.name || `${fmtLat(wp.lat)} ${fmtLon(wp.lon)}`}</option>
          ))}
        </select>
      </div>

      {/* ── EOSP selector ── */}
      <div style={{marginBottom:8}}>
        <label style={{...lblSt,color:"#DC2626"}}>{"\u25a0"} EOSP {"\u2014"} End of Sea Passage</label>
        <select value={ei} onChange={e => setEospIdx(parseInt(e.target.value))}
          style={{...inputSt,width:"100%",marginBottom:4,colorScheme:"dark"}}>
          {wps.map((wp, i) => i > bospIdx && (
            <option key={i} value={i}>WP {i+1} — {wp.name || `${fmtLat(wp.lat)} ${fmtLon(wp.lon)}`}</option>
          ))}
        </select>
      </div>

      {/* ── BOSP departure time ── */}
      <label style={lblSt}>BOSP Departure (UTC)</label>
      <input type="datetime-local" value={bospDT} onChange={e=>setBospDT(e.target.value)}
        style={{...inputSt,marginBottom:8,colorScheme:"dark",width:"100%"}} />

      {/* ── Default speed ── */}
      <label style={lblSt}>Default Passage Speed (kts)</label>
      <input type="number" value={voyageSpeed} min={1} max={30} step={0.5}
        onChange={e=>setVoyageSpeed(parseFloat(e.target.value)||15)}
        style={{...inputSt,marginBottom:8,width:"100%"}} />

      {/* ── Per-leg speed table ── */}
      {passageWPs.length > 1 && (
        <div style={{marginBottom:10}}>
          <div style={{color:"#94A3B8",fontSize:9,fontWeight:700,letterSpacing:"0.1em",
            textTransform:"uppercase",marginBottom:4}}>Leg Speeds</div>
          <div style={{maxHeight:200,overflowY:"auto",border:"1px solid #334155",
            borderRadius:4,background:"#0F172A"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,
              fontFamily:"'JetBrains Mono',monospace"}}>
              <thead>
                <tr style={{color:"#64748B",background:"#0F172A",position:"sticky",top:0}}>
                  <th style={{textAlign:"left",padding:"3px 4px",borderBottom:"1px solid #334155"}}>Leg</th>
                  <th style={{textAlign:"right",padding:"3px 4px",borderBottom:"1px solid #334155"}}>NM</th>
                  <th style={{textAlign:"center",padding:"3px 4px",borderBottom:"1px solid #334155"}}>Speed</th>
                </tr>
              </thead>
              <tbody>
                {passageWPs.slice(0, -1).map((wp, li) => {
                  const absIdx = bospIdx + li; // absolute index in route
                  const nextWP = passageWPs[li + 1];
                  const legNM = voyageWPs?.[absIdx + 1]?.legNM;
                  const spd = legSpeeds[absIdx] ?? voyageSpeed;
                  const isOverride = legSpeeds[absIdx] != null;
                  return (
                    <tr key={li} style={{borderBottom:"1px solid #1E293B"}}>
                      <td style={{padding:"3px 4px",color:"#CBD5E1"}}>
                        <span style={{color:"#F59E0B",fontWeight:700}}>{absIdx+1}</span>
                        <span style={{color:"#64748B"}}>{"\u2192"}</span>
                        <span style={{color:"#F59E0B",fontWeight:700}}>{absIdx+2}</span>
                      </td>
                      <td style={{padding:"3px 4px",textAlign:"right",color:"#3B82F6"}}>
                        {legNM ? legNM.toFixed(0) : "—"}
                      </td>
                      <td style={{padding:"2px 4px",textAlign:"center"}}>
                        <input type="number" value={spd} min={1} max={30} step={0.5}
                          onChange={e => setLegSpeed(absIdx, parseFloat(e.target.value) || voyageSpeed)}
                          style={{...inputSt,width:"4em",textAlign:"center",padding:"2px 3px",
                            fontSize:10,
                            borderColor:isOverride?"#F59E0B":"#334155",
                            color:isOverride?"#F59E0B":"#CBD5E1"}} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{fontSize:8,color:"#475569",marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>
            Amber = custom speed {"\u00b7"} Default: {voyageSpeed} kts</div>
        </div>
      )}

      {/* ── Calculate button ── */}
      <button onClick={calcVoyage} style={{...btnSt,width:"100%",
        background:"linear-gradient(90deg,#3B82F6,#2563EB)",color:"#fff"}}>
        {"\ud83d\udccd"} CALCULATE VOYAGE ETAs</button>

      {/* ── Voyage summary ── */}
      {voyageWPs && (() => {
        const inPassage = voyageWPs.filter(w => w.inPassage !== false && w.etaMs != null);
        const totalNM = inPassage.length ? inPassage[inPassage.length - 1].cumNM : 0;
        const bospWP = voyageWPs[bospIdx];
        const eospWP = voyageWPs[ei];
        const durationH = (bospWP && eospWP?.etaMs) ? (eospWP.etaMs - bospWP.etaMs) / 3600000 : 0;
        return (
          <div style={{marginTop:8,padding:"6px 8px",background:"#0F172A",borderRadius:4,
            fontSize:10,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8}}>
            <div style={{color:"#16A34A"}}>BOSP: <b>WP{bospIdx+1}</b> — {wps[bospIdx]?.name||"—"}</div>
            <div style={{color:"#DC2626"}}>EOSP: <b>WP{ei+1}</b> — {wps[ei]?.name||"—"}
              {eospWP?.etaMs && <span style={{color:"#94A3B8"}}> — {new Date(eospWP.etaMs).toUTCString().slice(0,25)}</span>}
            </div>
            <div style={{color:"#64748B"}}>Passage: <b style={{color:"#3B82F6"}}>{(totalNM||0).toFixed(0)} NM</b>
              {" \u00b7 "}<b style={{color:"#F59E0B"}}>{(durationH/24).toFixed(1)} days</b>
              {" \u00b7 "}<b style={{color:"#94A3B8"}}>{durationH.toFixed(1)} h</b></div>
          </div>
        );
      })()}
    </Panel>
  );
}
