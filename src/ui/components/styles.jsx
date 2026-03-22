// ─── Shared styles & layout helpers ──────────────────────────────────────────
// Extracted from App.jsx — Phase 1, Item 1

export const inputStyle = {
  background: "#0F172A", border: "1px solid #334155", borderRadius: 4,
  color: "#E2E8F0", padding: "6px 8px", fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace", width: "100%",
  boxSizing: "border-box", outline: "none",
};

export const labelStyle = {
  color: "#94A3B8", fontSize: 10, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.1em",
  marginBottom: 3, display: "block",
  fontFamily: "'JetBrains Mono', monospace",
};

export function sectionHeader(text) {
  return (
    <div style={{
      color: "#F59E0B", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.15em", textTransform: "uppercase",
      borderBottom: "1px solid #1E293B", paddingBottom: 6,
      marginBottom: 10, fontFamily: "'JetBrains Mono', monospace",
    }}>{text}</div>
  );
}

export function statBox(label, value, unit, color = "#E2E8F0") {
  return (
    <div style={{ textAlign: "center", padding: "6px 4px" }}>
      <div style={{
        color, fontSize: 18, fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {typeof value === "number" ? (isFinite(value) ? value.toFixed(2) : "∞") : value}
      </div>
      <div style={{
        color: "#64748B", fontSize: 9, textTransform: "uppercase",
        letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace",
      }}>
        {label} {unit && <span style={{ color: "#475569" }}>({unit})</span>}
      </div>
    </div>
  );
}

export function Panel({ children, style = {} }) {
  return (
    <div style={{
      background: "#1E293B", borderRadius: 8, padding: 16,
      border: "1px solid #334155", ...style,
    }}>
      {children}
    </div>
  );
}
