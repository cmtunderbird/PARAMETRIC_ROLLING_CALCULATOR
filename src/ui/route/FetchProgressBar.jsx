// ─── FetchProgressBar.jsx — Unified route weather fetch progress ──────────────
// Single progress bar for the entire pipeline:
//   ETA calc → source probe → marine grid → wind grid → voyage weather → motions

export default function FetchProgressBar({ stage, pct, detail, modelFamily }) {
  if (!stage) return null;
  const done = pct >= 100;
  const barColor = done ? "#16A34A" : "#F59E0B";
  return (
    <div style={{
      background: "#0F172A", borderRadius: 6, padding: "10px 14px",
      border: `1px solid ${done ? "#16A34A50" : "#F59E0B50"}`,
      fontFamily: "'JetBrains Mono', monospace", marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: done ? "#22C55E" : "#FBBF24",
          letterSpacing: "0.05em" }}>
          {done ? "✓ ROUTE WEATHER LOADED" : "⟳ FETCHING ROUTE WEATHER..."}
        </div>
        <div style={{ fontSize: 9, color: "#64748B" }}>
          {modelFamily?.label || ""}
          {pct < 100 && ` — ${pct}%`}
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, background: "#1E293B", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
        <div style={{
          width: `${Math.max(pct, 2)}%`, height: "100%",
          background: `linear-gradient(90deg, ${barColor}, ${done ? "#22C55E" : "#D97706"})`,
          borderRadius: 3, transition: "width 0.4s ease-out",
        }} />
      </div>
      {/* Stage detail */}
      <div style={{ fontSize: 9, color: "#94A3B8" }}>
        {stage}{detail ? ` — ${detail}` : ""}
      </div>
    </div>
  );
}
