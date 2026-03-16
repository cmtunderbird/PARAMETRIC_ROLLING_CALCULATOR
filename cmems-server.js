// ─── cmems-server.js ───────────────────────────────────────────────────────────
// Local Express proxy — bridges browser to the new Copernicus Marine Toolbox v2.
// Uses a single persistent Python worker (cmems_worker.py) instead of spawning
// a new process per request — dataset handles are cached in Python memory,
// making calls after the first ~5s instead of ~60s.

import express   from "express";
import cors      from "cors";
import { spawn } from "child_process";
import path      from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = 5174;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Per-request timeout: 130s (covers worst-case first-dataset-open ~120s) ───
app.use((req, res, next) => {
  res.setTimeout(130_000, () => {
    if (!res.headersSent) res.status(503).json({ error: "Request timeout (130s)" });
  });
  next();
});

// ── Persistent Python worker ──────────────────────────────────────────────────
let worker      = null;   // child_process
let workerReady = false;  // true once "{"ready":true}" received from worker
const pending   = [];     // queue of { resolve, reject, timer } waiting for a response

function spawnWorker() {
  // Resolve worker path: packaged Electron app puts extraResources in resourcesPath
  const workerPath = process.env.CMEMS_WORKER_PATH
    || path.join(__dirname, "cmems_worker.py");
  worker = spawn("python", [workerPath], { stdio: ["pipe","pipe","pipe"] });
  workerReady = false;

  let buf = "";
  worker.stdout.on("data", chunk => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop();                        // keep incomplete line in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.ready) { workerReady = true; console.log("CMEMS worker ready"); continue; }
        const next = pending.shift();
        if (next) { clearTimeout(next.timer); next.resolve(msg); }
      } catch { /* partial JSON — wait for more */ }
    }
  });

  worker.stderr.on("data", d => {
    const t = d.toString();
    if (!t.includes("UserWarning") && !t.includes("DeprecationWarning"))
      process.stderr.write("[cmems_worker] " + t);
  });

  worker.on("close", code => {
    console.warn(`CMEMS worker exited (code ${code}) — restarting in 2s`);
    workerReady = false;
    worker = null;
    // Reject any in-flight requests
    while (pending.length) {
      const p = pending.shift();
      clearTimeout(p.timer);
      p.reject(new Error("CMEMS worker restarted — retry your request"));
    }
    setTimeout(spawnWorker, 2000);
  });
}

// Start worker immediately on server boot
spawnWorker();

// ── Send a command to the worker and await its response ───────────────────────
const WORKER_TIMEOUT = 120_000; // 2 min — first dataset open can take ~60s

function workerCall(cmd) {
  return new Promise((resolve, reject) => {
    if (!worker || !workerReady)
      return reject(new Error("CMEMS worker not ready — retry in a moment"));
    const timer = setTimeout(() => {
      const idx = pending.findIndex(p => p.resolve === resolve);
      if (idx >= 0) pending.splice(idx, 1);
      reject(new Error("CMEMS worker timeout (120s)"));
    }, WORKER_TIMEOUT);
    pending.push({ resolve, reject, timer });
    worker.stdin.write(JSON.stringify(cmd) + "\n");
  });
}

// ── Extract credentials from Authorization: Basic header ─────────────────────
function getCredentials(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const colon   = decoded.indexOf(":");
    if (colon < 1) return null;
    return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
  } catch { return null; }
}

// ── Time range helper ─────────────────────────────────────────────────────────
const fmtDT = d => d.toISOString().slice(0, 19);

// ── /api/cmems/test ───────────────────────────────────────────────────────────
app.get("/api/cmems/test", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.status(401).json({ ok: false, message: "Missing or invalid Authorization header." });
  try {
    const result = await workerCall({ action:"test", user: creds.user, password: creds.pass });
    if (result.error) return res.json({ ok: false, message: result.error });
    res.json(result);
  } catch(e) { res.json({ ok: false, message: e.message }); }
});

// ── /api/cmems/wave ───────────────────────────────────────────────────────────
app.get("/api/cmems/wave", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.status(401).json({ error: "Missing Authorization header" });
  const { south, north, west, east, forecastDays = 7 } = req.query;
  const now = new Date();
  const end = new Date(now.getTime() + parseInt(forecastDays) * 86_400_000);
  try {
    const result = await workerCall({
      action: "wave", user: creds.user, password: creds.pass,
      south: parseFloat(south), north: parseFloat(north),
      west:  parseFloat(west),  east:  parseFloat(east),
      start: fmtDT(now), end: fmtDT(end),
    });
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── /api/cmems/physics ────────────────────────────────────────────────────────
app.get("/api/cmems/physics", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.status(401).json({ error: "Missing Authorization header" });
  const { south, north, west, east } = req.query;
  const now = new Date();
  const end = new Date(now.getTime() + 2 * 86_400_000);
  try {
    const result = await workerCall({
      action: "physics", user: creds.user, password: creds.pass,
      south: parseFloat(south), north: parseFloat(north),
      west:  parseFloat(west),  east:  parseFloat(east),
      start: fmtDT(now), end: fmtDT(end),
    });
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health",       (_, res) => res.json({ ok: true, server: "cmems-proxy", version: "2.1", workerReady }));
app.get("/api/cmems/health", (_, res) => res.json({ ok: true, server: "cmems-proxy", version: "2.1", workerReady }));

app.listen(PORT, () => console.log(`CMEMS proxy server running on http://localhost:${PORT}`));
