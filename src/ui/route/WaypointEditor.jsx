// ─── WaypointEditor — waypoint CRUD table ────────────────────────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2
import { btnSt, inputSt, Panel } from "./shared.jsx";

export default function WaypointEditor({
  route, editMode, setEditMode, editingIdx, setEditingIdx,
  editForm, setEditForm, wpDelete, wpInsertAfter, wpSaveEdit,
  wpMoveUp, wpMoveDown,
}) {
  if (!route) return null;
  return (
    <Panel style={{padding:editMode?12:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:editMode?10:0}}>
        <div style={{color:"#F59E0B",fontSize:11,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>
          {"\u270f\ufe0f"} Route Editor
          <span style={{color:"#64748B",fontSize:9,fontWeight:400,marginLeft:8}}>{route.waypoints.length} WPs</span>
        </div>
        <button onClick={()=>{ setEditMode(m=>!m); setEditingIdx(null); }}
          style={{...btnSt,padding:"4px 10px",fontSize:10,
            background:editMode?"linear-gradient(90deg,#7C3AED,#6D28D9)":"linear-gradient(90deg,#334155,#475569)",
            color:"#E2E8F0"}}>
          {editMode ? "\u2713 DONE" : "\u270f EDIT"}
        </button>
      </div>
      {editMode && (
        <div style={{maxHeight:320,overflowY:"auto"}}>
          {route.waypoints.map((wp, idx) => (
            <div key={idx}>
              {editingIdx !== idx ? (
                <div style={{display:"flex",alignItems:"center",gap:4,padding:"4px 2px",
                  borderBottom:"1px solid #1E293B",
                  background: idx===0?"#16A34A0A": idx===route.waypoints.length-1?"#DC26260A":"transparent"}}>
                  <div style={{minWidth:20,height:20,borderRadius:"50%",
                    background:idx===0?"#16A34A":idx===route.waypoints.length-1?"#DC2626":"#475569",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:8,fontWeight:900,color:"#fff",flexShrink:0}}>{idx+1}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:"#E2E8F0",fontSize:10,fontWeight:600,
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                      fontFamily:"'JetBrains Mono',monospace"}}>{wp.name||`WP${idx+1}`}</div>
                    <div style={{color:"#64748B",fontSize:8,fontFamily:"'JetBrains Mono',monospace"}}>
                      {wp.lat.toFixed(3)}{"\u00b0"}, {wp.lon.toFixed(3)}{"\u00b0"}</div>
                  </div>
                  <div style={{display:"flex",gap:2,flexShrink:0}}>
                    <button onClick={()=>wpMoveUp(idx)} disabled={idx===0} title="Move up"
                      style={{...btnSt,padding:"2px 5px",fontSize:10,background:"#0F172A",color:idx===0?"#334155":"#94A3B8",border:"1px solid #334155"}}>{"\u25b2"}</button>
                    <button onClick={()=>wpMoveDown(idx)} disabled={idx===route.waypoints.length-1} title="Move down"
                      style={{...btnSt,padding:"2px 5px",fontSize:10,background:"#0F172A",color:idx===route.waypoints.length-1?"#334155":"#94A3B8",border:"1px solid #334155"}}>{"\u25bc"}</button>
                    <button onClick={()=>{ setEditingIdx(idx); setEditForm({name:wp.name||"",lat:String(wp.lat),lon:String(wp.lon)}); }} title="Edit"
                      style={{...btnSt,padding:"2px 5px",fontSize:10,background:"#0F172A",color:"#F59E0B",border:"1px solid #F59E0B50"}}>{"\u270e"}</button>
                    <button onClick={()=>wpInsertAfter(idx)} title="Insert WP after"
                      style={{...btnSt,padding:"2px 5px",fontSize:10,background:"#0F172A",color:"#22D3EE",border:"1px solid #22D3EE50"}}>+</button>
                    <button onClick={()=>wpDelete(idx)} disabled={route.waypoints.length<=2} title="Delete"
                      style={{...btnSt,padding:"2px 5px",fontSize:10,background:"#0F172A",
                        color:route.waypoints.length<=2?"#334155":"#EF4444",
                        border:`1px solid ${route.waypoints.length<=2?"#334155":"#EF444450"}`}}>{"\u2715"}</button>
                  </div>
                </div>
              ) : (
                <div style={{background:"#0F172A",borderRadius:4,padding:8,marginBottom:4,border:"1px solid #F59E0B60"}}>
                  <div style={{color:"#F59E0B",fontSize:9,fontWeight:700,marginBottom:6,fontFamily:"'JetBrains Mono',monospace"}}>EDITING WP {idx+1}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr",gap:4,marginBottom:6}}>
                    <input value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))}
                      placeholder="WP name (e.g. BISHOP ROCK)" style={{...inputSt,fontSize:11,padding:"4px 6px"}} />
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                      <input value={editForm.lat} onChange={e=>setEditForm(f=>({...f,lat:e.target.value}))}
                        placeholder="Latitude" style={{...inputSt,fontSize:11,padding:"4px 6px",borderColor:isNaN(parseFloat(editForm.lat))?"#EF4444":"#334155"}} />
                      <input value={editForm.lon} onChange={e=>setEditForm(f=>({...f,lon:e.target.value}))}
                        placeholder="Longitude" style={{...inputSt,fontSize:11,padding:"4px 6px",borderColor:isNaN(parseFloat(editForm.lon))?"#EF4444":"#334155"}} />
                    </div>
                  </div>
                  <div style={{fontSize:8,color:"#64748B",marginBottom:6,fontFamily:"'JetBrains Mono',monospace"}}>
                    Decimal degrees {"\u00b7"} N/E positive {"\u00b7"} S/W negative<br/>Or drag the marker on the map to reposition</div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>wpSaveEdit(idx)} style={{...btnSt,flex:1,padding:"4px",fontSize:10,
                      background:"linear-gradient(90deg,#16A34A,#15803D)",color:"#fff"}}>{"\u2713"} SAVE</button>
                    <button onClick={()=>setEditingIdx(null)} style={{...btnSt,padding:"4px 8px",fontSize:10,
                      background:"#334155",color:"#94A3B8"}}>{"\u2715"}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <button onClick={()=>wpInsertAfter(route.waypoints.length-1)}
            style={{...btnSt,width:"100%",marginTop:6,padding:"5px",fontSize:10,
              background:"#0F172A",color:"#22D3EE",border:"1px dashed #22D3EE40"}}>+ ADD WAYPOINT AT END</button>
          <div style={{color:"#475569",fontSize:8,marginTop:4,textAlign:"center",fontFamily:"'JetBrains Mono',monospace"}}>
            Drag markers on map to reposition {"\u00b7"} Min 2 WPs required</div>
        </div>
      )}
    </Panel>
  );
}
