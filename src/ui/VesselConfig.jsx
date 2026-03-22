// ─── VesselConfig.jsx — Hull dimensions & stability tab ──────────────────────
// Extracted from App.jsx — Phase 1, Item 1
import { Field, sectionHeader, statBox, Panel, labelStyle } from "./components/index.js";

export default function VesselConfig({ ship, updateShip, Tr }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 800 }}>
      <Panel>
        {sectionHeader("Hull Dimensions")}
        <Field label="Length Waterline (Lwl)" value={ship.Lwl} onChange={(v) => updateShip("Lwl", v)} unit="m" step={1} min={10} />
        <Field label="Beam (B)" value={ship.B} onChange={(v) => updateShip("B", v)} unit="m" step={0.1} min={1} />
        <Field label="Draft (d)" value={ship.d} onChange={(v) => updateShip("d", v)} unit="m" step={0.1} min={0.5} />
        <Field label="Block Coefficient (Cb)" value={ship.Cb} onChange={(v) => updateShip("Cb", v)} unit="" step={0.01} min={0.3} max={0.95} />
      </Panel>

      <Panel>
        {sectionHeader("Stability & Damping")}
        <Field label="Metacentric Height (GM)" value={ship.GM} onChange={(v) => updateShip("GM", v)} unit="m" step={0.05} min={0.01} />
        <Field label="Roll Damping Ratio (\u03b6)" value={ship.rollDamping ?? 0.05}
          onChange={(v) => updateShip("rollDamping", Math.max(0.01, Math.min(0.30, v)))}
          unit="" step={0.005} min={0.01} max={0.30} />
        <div style={{ marginBottom: 12, padding: "6px 8px", background: "#0F172A", borderRadius: 4,
          border: "1px solid #334155", fontSize: 9, color: "#64748B", lineHeight: 1.8,
          fontFamily: "'JetBrains Mono', monospace" }}>
          <span style={{ color: "#F59E0B", fontWeight: 700 }}>\u03b6 guide:</span><br/>
          No bilge keels: 0.03 \u2013 0.06<br/>
          With bilge keels: 0.07 \u2013 0.12<br/>
          Active fin stabilisers: 0.12 \u2013 0.20<br/>
          <span style={{ color: "#EF4444" }}>\u26a0 At resonance, roll \u221d 1/(2\u03b6) \u2014 doubling \u03b6 halves roll amplitude</span>
        </div>
        <div style={{ marginTop: 4, padding: 12, background: "#0F172A", borderRadius: 6, border: "1px solid #334155" }}>
          <div style={{ color: "#F59E0B", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>COMPUTED RESULTS (IMO Method)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {statBox("Nat. Roll Period T\u1d63", Tr, "s", "#3B82F6")}
            {statBox("C Factor", (0.373 + 0.023 * (ship.B / ship.d) - 0.043 * (ship.Lwl / 100)), "", "#22D3EE")}
            {statBox("Rad. of Gyration k", 0.39 * ship.B, "m", "#A855F7")}
            {statBox("B/d Ratio", ship.B / ship.d, "", "#10B981")}
          </div>
        </div>
        <div style={{ marginTop: 12, padding: 10, background: "#1a1a2e", borderRadius: 4, border: "1px solid #334155" }}>
          <div style={{ color: "#94A3B8", fontSize: 10, lineHeight: 1.6 }}>
            <strong style={{ color: "#F59E0B" }}>IMO Formula:</strong> T\u1d63 = 2\u00b7C\u00b7B / \u221aGM<br />
            <strong style={{ color: "#F59E0B" }}>C =</strong> 0.373 + 0.023\u00b7(B/d) \u2212 0.043\u00b7(Lwl/100)<br />
            <strong style={{ color: "#F59E0B" }}>Source:</strong> 2008 IS Code (Res. MSC.267(85))
          </div>
        </div>
      </Panel>
    </div>
  );
}
