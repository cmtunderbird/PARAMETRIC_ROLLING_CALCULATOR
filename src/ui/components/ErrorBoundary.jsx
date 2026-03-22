// ─── ErrorBoundary — catches render errors, shows recovery UI ────────────────
// Phase 1, Item 7 — critical for bridge use where the tool must never go blank
import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error(`[ErrorBoundary] ${this.props.name || "Component"} crashed:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const name = this.props.name || "Component";
      return (
        <div style={{
          background: "#1E293B", border: "2px solid #DC2626", borderRadius: 8,
          padding: 20, margin: 8, fontFamily: "'JetBrains Mono', monospace",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 24 }}>⚠</span>
            <div>
              <div style={{ color: "#DC2626", fontSize: 14, fontWeight: 800, letterSpacing: "0.1em" }}>
                {name.toUpperCase()} ERROR
              </div>
              <div style={{ color: "#94A3B8", fontSize: 11, marginTop: 2 }}>
                This panel encountered an error and has been isolated.
                Other panels continue to function normally.
              </div>
            </div>
          </div>
          <div style={{ background: "#0F172A", borderRadius: 4, padding: 10,
            border: "1px solid #334155", marginBottom: 12 }}>
            <div style={{ color: "#EF4444", fontSize: 11, wordBreak: "break-word" }}>
              {this.state.error?.message || "Unknown error"}
            </div>
            {this.state.errorInfo?.componentStack && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ color: "#64748B", fontSize: 10, cursor: "pointer" }}>
                  Component stack trace
                </summary>
                <pre style={{ color: "#475569", fontSize: 9, marginTop: 4,
                  whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
          <button onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{
              padding: "8px 16px", border: "none", borderRadius: 4, cursor: "pointer",
              background: "linear-gradient(90deg, #F59E0B, #D97706)", color: "#0F172A",
              fontWeight: 800, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.1em",
            }}>
            ⟳ RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
