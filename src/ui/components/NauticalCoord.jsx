// ─── Nautical Coordinate Helpers & Input ─────────────────────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { inputStyle, labelStyle } from "./styles.jsx";

export function decimalToNautical(decimal, isLat) {
  const hemi = isLat ? (decimal >= 0 ? "N" : "S") : (decimal >= 0 ? "E" : "W");
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const min = parseFloat(((abs - deg) * 60).toFixed(1));
  return { deg, min, hemi };
}

export function nauticalToDecimal(deg, min, hemi) {
  const decimal = deg + min / 60;
  return (hemi === "S" || hemi === "W") ? -decimal : decimal;
}

export function formatNauticalLat(deg, min, hemi) {
  return `${String(deg).padStart(2, "0")}°-${min.toFixed(1).padStart(4, "0")}′ ${hemi}`;
}

export function formatNauticalLon(deg, min, hemi) {
  return `${String(deg).padStart(3, "0")}°-${min.toFixed(1).padStart(4, "0")}′ ${hemi}`;
}

const coordFieldStyle = { ...inputStyle, textAlign: "center", padding: "6px 4px" };

export function NauticalCoordInput({
  label, deg, min, hemi,
  onDegChange, onMinChange, onHemiChange, isLat,
}) {
  const maxDeg = isLat ? 90 : 180;
  const hemiOptions = isLat ? ["N", "S"] : ["E", "W"];
  const degWidth = isLat ? "2.2em" : "2.8em";
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>
        {label}{" "}
        <span style={{ color: "#64748B" }}>
          ({isLat ? "DD-MM.M N/S" : "DDD-MM.M E/W"})
        </span>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <input type="number" value={deg} min={0} max={maxDeg} step={1}
          onChange={(e) => {
            let v = parseInt(e.target.value) || 0;
            v = Math.max(0, Math.min(maxDeg, v));
            onDegChange(v);
          }}
          style={{ ...coordFieldStyle, width: degWidth, flex: "none" }}
          onFocus={(e) => e.target.style.borderColor = "#F59E0B"}
          onBlur={(e) => e.target.style.borderColor = "#334155"} />
        <span style={{ color: "#F59E0B", fontSize: 14, fontWeight: 800, lineHeight: 1 }}>°</span>
        <span style={{ color: "#64748B", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>—</span>
        <input type="number" value={min} min={0} max={59.9} step={0.1}
          onChange={(e) => {
            let v = parseFloat(e.target.value) || 0;
            v = Math.max(0, Math.min(59.9, v));
            onMinChange(parseFloat(v.toFixed(1)));
          }}
          style={{ ...coordFieldStyle, width: "3.5em", flex: "none" }}
          onFocus={(e) => e.target.style.borderColor = "#F59E0B"}
          onBlur={(e) => e.target.style.borderColor = "#334155"} />
        <span style={{ color: "#F59E0B", fontSize: 12, fontWeight: 800, lineHeight: 1 }}>′</span>
        {hemiOptions.map(h => (
          <button key={h} onClick={() => onHemiChange(h)} style={{
            padding: "5px 8px",
            border: `1px solid ${hemi === h ? "#F59E0B" : "#334155"}`,
            borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 800,
            fontFamily: "'JetBrains Mono', monospace",
            background: hemi === h ? "#F59E0B" : "#0F172A",
            color: hemi === h ? "#0F172A" : "#64748B",
            transition: "all 0.2s", flex: "none", minWidth: 28, textAlign: "center",
          }}>{h}</button>
        ))}
      </div>
      <div style={{ color: "#475569", fontSize: 9, marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>
        {isLat ? formatNauticalLat(deg, min, hemi) : formatNauticalLon(deg, min, hemi)} = {nauticalToDecimal(deg, min, hemi).toFixed(4)}°
      </div>
    </div>
  );
}
