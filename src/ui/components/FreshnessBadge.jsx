// ─── FreshnessBadge.jsx — Shows data source + age per reading ────────────────
// Phase 3, Item 23
// Displays on every risk reading: model run time, hours until expiry,
// data source badge. A 6h-old GFS is trustworthy; 48h-old cached data
// needs a warning.
import { useMemo } from "react";

const SOURCE_STYLES = {
  openmeteo:     { label: "Open-Meteo", color: "#3B82F6", abbr: "OM" },
  noaa_gfs:      { label: "NOAA GFS", color: "#22C55E", abbr: "GFS" },
  noaa_wwiii:    { label: "NOAA WW3", color: "#16A34A", abbr: "WW3" },
  cmems:         { label: "CMEMS", color: "#A855F7", abbr: "CM" },
  cache_stale:   { label: "Cached", color: "#F59E0B", abbr: "CACHE" },
  manual:        { label: "Manual", color: "#7C3AED", abbr: "MAN" },
};

export default function FreshnessBadge({ provider, modelRun, lastFetch, expiryHours = 6 }) {
  const style = SOURCE_STYLES[provider] || SOURCE_STYLES.openmeteo;

  const ageInfo = useMemo(() => {
    if (!lastFetch) return { ageStr: "—", hoursLeft: 0, urgent: false };
    const ageMs = Date.now() - (lastFetch instanceof Date ? lastFetch.getTime() : new Date(lastFetch).getTime());
    const ageH = ageMs / 3600000;
    const left = Math.max(0, expiryHours - ageH);
    return {
      ageStr: ageH < 1 ? `${Math.round(ageH * 60)}m` : `${ageH.toFixed(1)}h`,
      hoursLeft: left,
      urgent: left < 1,
    };
  }, [lastFetch, expiryHours]);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4,
      fontFamily: "'JetBrains Mono', monospace" }}>
      {/* Source badge */}
      <span style={{
        fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 2,
        background: style.color + "25", color: style.color,
        letterSpacing: "0.05em",
      }}>{style.abbr}</span>
      {/* Age */}
      <span style={{
        fontSize: 8, color: ageInfo.urgent ? "#EF4444" : "#64748B",
        fontWeight: ageInfo.urgent ? 700 : 400,
      }}>
        {ageInfo.ageStr}
      </span>
      {/* Model run if available */}
      {modelRun && (
        <span style={{ fontSize: 7, color: "#475569" }}
          title={`Model run: ${modelRun}`}>
          [{modelRun.split("/").pop()}]
        </span>
      )}
      {/* Expiry warning */}
      {ageInfo.urgent && (
        <span style={{ fontSize: 8, color: "#EF4444", fontWeight: 800 }}
          title="Data approaching expiry — refresh recommended">⏱</span>
      )}
    </div>
  );
}
