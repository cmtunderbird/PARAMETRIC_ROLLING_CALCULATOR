// ─── StaleDataBanner — prominent warning when showing old/cached data ────────
// Phase 1, Item 8 — offline / stale-cache display
// Shows data age and source when weather data is not fresh

export default function StaleDataBanner({ lastFetch, dataAgeMinutes, isStale, isOffline }) {
  if (!lastFetch && !isOffline) return null;

  const ageMin = dataAgeMinutes || 0;
  const ageStr = ageMin < 60
    ? `${Math.round(ageMin)} min ago`
    : ageMin < 1440
      ? `${Math.round(ageMin / 60)} hours ago`
      : `${Math.round(ageMin / 1440)} days ago`;

  // Fresh data (< 30 min) — no banner needed
  if (!isStale && !isOffline && ageMin < 30) return null;

  const severity = isOffline ? "offline"
    : ageMin > 360 ? "critical"   // > 6 hours
    : ageMin > 120 ? "warning"    // > 2 hours
    : "info";                     // 30-120 min

  const styles = {
    offline:  { bg: "#7C3AED20", border: "#7C3AED", color: "#C4B5FD", icon: "📡", label: "OFFLINE — NO CONNECTION" },
    critical: { bg: "#DC262620", border: "#DC2626", color: "#FCA5A5", icon: "⚠", label: "STALE DATA" },
    warning:  { bg: "#D9770620", border: "#D97706", color: "#FCD34D", icon: "⏳", label: "AGING DATA" },
    info:     { bg: "#3B82F620", border: "#3B82F6", color: "#93C5FD", icon: "ℹ", label: "CACHED DATA" },
  }[severity];

  return (
    <div style={{
      background: styles.bg, border: `1px solid ${styles.border}`,
      borderRadius: 6, padding: "8px 14px", marginBottom: 12,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{styles.icon}</span>
        <div>
          <div style={{ color: styles.color, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>
            {styles.label}
          </div>
          <div style={{ color: "#94A3B8", fontSize: 9, marginTop: 2 }}>
            {isOffline
              ? "Weather fetch failed. Showing last available data."
              : `Data fetched ${ageStr}. Risk assessment may not reflect current conditions.`}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right", fontSize: 9, color: "#64748B" }}>
        {lastFetch && <div>Last update: {new Date(lastFetch).toLocaleTimeString()}</div>}
        {ageMin > 0 && <div style={{ color: styles.color, fontWeight: 700 }}>Age: {ageStr}</div>}
      </div>
    </div>
  );
}
