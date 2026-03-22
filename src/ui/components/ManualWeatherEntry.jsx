// ─── ManualWeatherEntry — fallback when no weather data available ─────────────
// Phase 1, Item 8 — the tool must always function
// Mariner enters Hs, Tw, direction manually from bridge observations or VHF weather
import { useState } from "react";
import { inputStyle, labelStyle, sectionHeader, Panel } from "./styles.jsx";
import Field from "./Field.jsx";

export default function ManualWeatherEntry({ onApply }) {
  const [hs, setHs] = useState(2.0);
  const [tw, setTw] = useState(8.0);
  const [waveDir, setWaveDir] = useState(270);
  const [swellHs, setSwellHs] = useState(1.0);
  const [swellTw, setSwellTw] = useState(12.0);
  const [swellDir, setSwellDir] = useState(250);
  const [windSpd, setWindSpd] = useState(20);
  const [windDir, setWindDir] = useState(270);

  const handleApply = () => {
    // Build a synthetic weather snapshot matching the format from Open-Meteo
    const now = Date.now();
    const snapshot = Array.from({ length: 168 }, (_, i) => ({
      time: now + i * 3600000,
      waveHeight: hs, wavePeriod: tw, waveDir: waveDir,
      swellHeight: swellHs, swellPeriod: swellTw, swellDir: swellDir,
      windWaveHeight: hs * 0.6, windWavePeriod: tw * 0.8, windWaveDir: waveDir,
    }));
    const windSnapshot = Array.from({ length: 168 }, (_, i) => ({
      time: now + i * 3600000,
      windSpeed: windSpd * 1.852, // kph for consistency with Open-Meteo
      windDir: windDir, windGusts: windSpd * 1.852 * 1.3,
    }));
    onApply(snapshot, windSnapshot);
  };

  return (
    <Panel style={{ border: "2px solid #7C3AED50" }}>
      {sectionHeader("\u270d Manual Weather Entry \u2014 Offline Mode")}
      <div style={{ color: "#C4B5FD", fontSize: 10, lineHeight: 1.6, marginBottom: 10,
        padding: "6px 8px", background: "#7C3AED15", borderRadius: 4, border: "1px solid #7C3AED30" }}>
        <strong>No weather data available.</strong> Enter current sea state from bridge
        observations, VHF weather broadcast, or passage plan forecast.
        The tool will use these values for all risk calculations.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ color: "#3B82F6", fontSize: 10, fontWeight: 700, marginBottom: 6,
            fontFamily: "'JetBrains Mono', monospace" }}>WAVES (Combined)</div>
          <Field label="Sig. Wave Height Hs" value={hs} onChange={setHs} unit="m" step={0.5} min={0} max={20} />
          <Field label="Wave Period Tw" value={tw} onChange={setTw} unit="s" step={0.5} min={2} max={25} />
          <Field label="Wave Direction" value={waveDir} onChange={setWaveDir} unit="\u00b0T FROM" step={5} min={0} max={359} />
        </div>
        <div>
          <div style={{ color: "#F59E0B", fontSize: 10, fontWeight: 700, marginBottom: 6,
            fontFamily: "'JetBrains Mono', monospace" }}>SWELL</div>
          <Field label="Swell Height" value={swellHs} onChange={setSwellHs} unit="m" step={0.5} min={0} max={15} />
          <Field label="Swell Period" value={swellTw} onChange={setSwellTw} unit="s" step={0.5} min={4} max={25} />
          <Field label="Swell Direction" value={swellDir} onChange={setSwellDir} unit="\u00b0T FROM" step={5} min={0} max={359} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ color: "#22D3EE", fontSize: 10, fontWeight: 700, marginBottom: 6,
          fontFamily: "'JetBrains Mono', monospace" }}>WIND</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="Wind Speed" value={windSpd} onChange={setWindSpd} unit="kts" step={1} min={0} max={100} />
          <Field label="Wind Direction" value={windDir} onChange={setWindDir} unit="\u00b0T FROM" step={5} min={0} max={359} />
        </div>
      </div>
      <button onClick={handleApply} style={{
        width: "100%", marginTop: 12, padding: "10px", border: "none", borderRadius: 4,
        background: "linear-gradient(90deg, #7C3AED, #6D28D9)", color: "#fff",
        fontWeight: 800, fontSize: 12, cursor: "pointer",
        fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em",
      }}>
        \u2713 APPLY MANUAL SEA STATE
      </button>
      <div style={{ color: "#475569", fontSize: 8, marginTop: 6, textAlign: "center",
        fontFamily: "'JetBrains Mono', monospace" }}>
        Values will be applied as a constant forecast for all calculations.
        Fetch live data when connection is restored.
      </div>
    </Panel>
  );
}
