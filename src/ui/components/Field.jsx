// ─── Field — numeric input with label and unit ──────────────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { inputStyle, labelStyle } from "./styles.jsx";

export default function Field({ label, value, onChange, unit, step = 0.1, min, max }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={labelStyle}>
        {label} {unit && <span style={{ color: "#64748B" }}>({unit})</span>}
      </label>
      <input type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={inputStyle}
        onFocus={(e) => e.target.style.borderColor = "#F59E0B"}
        onBlur={(e) => e.target.style.borderColor = "#334155"} />
    </div>
  );
}
