// ─── ResumeSessionDialog — shown on launch when a previous session exists ────
// Phase 1, Item 10 — watch handover
import { useState, useEffect } from "react";
import { loadSession, clearSession } from "../../services/sessionStore.js";

export default function ResumeSessionDialog({ onResume, onStartFresh }) {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    loadSession().then(s => { setSession(s); setChecking(false); })
      .catch(() => setChecking(false));
  }, []);

  // No previous session or still checking — render nothing
  if (checking || !session) return null;

  const savedAt = new Date(session.savedAt);
  const ageMin = Math.round((Date.now() - savedAt.getTime()) / 60000);
  const ageStr = ageMin < 60 ? `${ageMin} min ago`
    : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago`
    : `${Math.round(ageMin / 1440)}d ago`;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.75)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{
        background: "#1E293B", border: "2px solid #F59E0B", borderRadius: 12,
        padding: 28, maxWidth: 440, width: "90%",
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#F59E0B",
          letterSpacing: "0.1em", marginBottom: 12 }}>
          ⚓ PREVIOUS ASSESSMENT FOUND
        </div>
        <div style={{ color: "#CBD5E1", fontSize: 11, lineHeight: 1.7, marginBottom: 16 }}>
          A saved assessment from <strong style={{ color: "#22D3EE" }}>{ageStr}</strong> was
          found ({savedAt.toLocaleString()}). This may be from the previous watch.
        </div>
        <div style={{ background: "#0F172A", borderRadius: 6, padding: 12,
          border: "1px solid #334155", marginBottom: 16, fontSize: 10, color: "#94A3B8" }}>
          <div>Vessel: <strong style={{ color: "#E2E8F0" }}>{session.vesselName || "—"}</strong></div>
          {session.position && <div>Position: <strong style={{ color: "#E2E8F0" }}>{session.position}</strong></div>}
          {session.hasWeather && <div>Weather data: <span style={{ color: "#22C55E" }}>Available</span></div>}
          {session.hasRoute && <div>Route: <span style={{ color: "#22C55E" }}>Loaded</span></div>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { onResume(session); }} style={{
            flex: 1, padding: "10px", border: "none", borderRadius: 4, cursor: "pointer",
            background: "linear-gradient(90deg, #F59E0B, #D97706)", color: "#0F172A",
            fontWeight: 800, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.1em",
          }}>
            ⟳ RESUME ASSESSMENT
          </button>
          <button onClick={() => { clearSession(); onStartFresh(); }} style={{
            flex: 1, padding: "10px", border: "1px solid #475569", borderRadius: 4,
            cursor: "pointer", background: "transparent", color: "#94A3B8",
            fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.1em",
          }}>
            ✦ START FRESH
          </button>
        </div>
      </div>
    </div>
  );
}
