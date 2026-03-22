// ─── Shared styles for route panel components ────────────────────────────────
// Extracted from RouteChart.jsx — Phase 1, Item 2

export const riskColor = s => ["#0D9488","#16A34A","#CA8A04","#D97706","#EA580C","#DC2626","#7C3AED"][Math.min(s,6)]||"#64748B";
export const panelBg = "#1E293B";
export const inputSt = {background:"#0F172A",border:"1px solid #334155",borderRadius:4,color:"#E2E8F0",
  padding:"6px 8px",fontSize:12,fontFamily:"'JetBrains Mono',monospace",width:"100%",boxSizing:"border-box",outline:"none"};
export const btnSt = {padding:"8px 16px",border:"none",borderRadius:4,fontWeight:800,fontSize:11,
  fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",letterSpacing:"0.08em",transition:"all 0.2s"};
export const lblSt = {color:"#94A3B8",fontSize:10,fontWeight:600,textTransform:"uppercase",
  letterSpacing:"0.1em",marginBottom:3,display:"block",fontFamily:"'JetBrains Mono',monospace"};
export const SH = t => <div style={{color:"#F59E0B",fontSize:11,fontWeight:700,letterSpacing:"0.15em",
  textTransform:"uppercase",borderBottom:"1px solid #1E293B",paddingBottom:6,marginBottom:10,
  fontFamily:"'JetBrains Mono',monospace"}}>{t}</div>;
export const Panel = ({children,style={}}) => <div style={{background:panelBg,borderRadius:8,
  padding:16,border:"1px solid #334155",...style}}>{children}</div>;
