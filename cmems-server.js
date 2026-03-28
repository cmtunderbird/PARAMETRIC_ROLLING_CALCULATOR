// ─── cmems-server.js ───────────────────────────────────────────────────────────
// Local Express proxy — bridges browser to the new Copernicus Marine Toolbox v2.
// Uses a single persistent Python worker (cmems_worker.py) instead of spawning
// a new process per request — dataset handles are cached in Python memory,
// making calls after the first ~5s instead of ~60s.

import express             from "express";
import cors                from "cors";
import { spawn, spawnSync } from "child_process";
import path                from "path";
import fs                  from "fs";
import { fileURLToPath }   from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Resolve absolute path to python.exe ───────────────────────────────────────
// Mirrors the resolveNodeBin() pattern from electron/main.js.
// When cmems-server.js is spawned by Electron from a desktop shortcut, the
// child process inherits a restricted PATH that may not include Python.
// We use four fallback strategies to find a usable python executable:
//   1. PYTHON_EXE env var  — set by launch.bat (most reliable for shortcuts)
//   2. where.exe lookup    — works even when PATH is partially restricted
//   3. Known default paths — standard Windows + common virtual env locations
//   4. "python" / "python3"— last resort (relies on PATH being correct)
function resolvePythonBin() {
  // 1. Env var injected by launch.bat
  if (process.env.PYTHON_EXE && fs.existsSync(process.env.PYTHON_EXE)) {
    return process.env.PYTHON_EXE;
  }

  // 2. where.exe lookup — tries all names Python can have on Windows
  for (const name of ["python", "python3", "py"]) {
    try {
      const r = spawnSync("where.exe", [name], { encoding: "utf8" });
      if (r.stdout) {
        const first = r.stdout.trim().split("\n")[0].trim();
        // Skip Windows Store stub (opens the Store instead of running Python)
        if (first && fs.existsSync(first) && !first.includes("WindowsApps")) {
          return first;
        }
      }
    } catch { /* ignore */ }
  }

  // 3. Known default install locations
  const defaults = [
    // Standard Python.org Windows installer
    `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python312\\python.exe`,
    `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python311\\python.exe`,
    `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python310\\python.exe`,
    // Anaconda / Miniconda
    `${process.env.USERPROFILE}\\anaconda3\\python.exe`,
    `${process.env.USERPROFILE}\\miniconda3\\python.exe`,
    `C:\\ProgramData\\anaconda3\\python.exe`,
    `C:\\ProgramData\\miniconda3\\python.exe`,
    // System-wide Python.org install
    `C:\\Python312\\python.exe`,
    `C:\\Python311\\python.exe`,
    `C:\\Python310\\python.exe`,
  ];
  for (const p of defaults) {
    if (p && fs.existsSync(p)) return p;
  }

  // 4. Last resort — rely on PATH
  return "python";
}

const PYTHON_BIN = resolvePythonBin();
console.log(`[cmems-server] Python binary: ${PYTHON_BIN}`);
const app  = express();
const PORT = 5174;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Per-request timeout: 180s (covers worst-case first-dataset-open ~120s) ───
app.use((req, res, next) => {
  res.setTimeout(180_000, () => {
    if (!res.headersSent) res.status(503).json({ error: "Request timeout (180s)" });
  });
  next();
});

// ── Persistent Python worker ──────────────────────────────────────────────────
let worker      = null;    // child_process
let workerReady = false;   // true once {"ready":true} received from worker

// Correlation map: requestId → { resolve, reject, timer }
// Using a Map keyed by ID instead of a FIFO array prevents response
// mis-routing when concurrent requests (e.g. wave + physics) are in flight.
const pendingMap = new Map();
let   nextReqId  = 1;      // monotonically increasing request counter

function spawnWorker() {
  // Resolve worker path: packaged Electron app puts extraResources in resourcesPath
  const workerPath = process.env.CMEMS_WORKER_PATH
    || path.join(__dirname, "cmems_worker.py");
  worker = spawn(PYTHON_BIN, [workerPath], { stdio: ["pipe","pipe","pipe"] });
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
        // Ready handshake — not a response to any request
        if (msg.ready) { workerReady = true; console.log("CMEMS worker ready"); continue; }
        // Match response to caller by requestId
        const entry = pendingMap.get(msg.requestId);
        if (entry) {
          clearTimeout(entry.timer);
          pendingMap.delete(msg.requestId);
          entry.resolve(msg);
        } else {
          console.warn("[cmems-server] received response for unknown requestId:", msg.requestId);
        }
      } catch { /* partial JSON — wait for more data */ }
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
    // Reject all in-flight requests
    for (const [id, entry] of pendingMap) {
      clearTimeout(entry.timer);
      entry.reject(new Error("CMEMS worker restarted — retry your request"));
    }
    pendingMap.clear();
    setTimeout(spawnWorker, 2000);
  });
}

// Start worker immediately on server boot
spawnWorker();

// ── Send a command to the worker and await its response ───────────────────────
const WORKER_TIMEOUT = 300_000; // 5 min — first CMEMS physics dataset open can take 2-3 min

function workerCall(cmd) {
  return new Promise((resolve, reject) => {
    if (!worker || !workerReady)
      return reject(new Error("CMEMS worker not ready — retry in a moment"));

    // Assign a unique ID so the response handler can route the reply back to
    // exactly this promise — prevents data corruption when concurrent requests
    // (e.g. wave + physics) are in flight simultaneously.
    const requestId = nextReqId++;
    const cmdWithId = { ...cmd, requestId };

    const timer = setTimeout(() => {
      pendingMap.delete(requestId);
      reject(new Error("CMEMS worker timeout (5 min)"));
    }, WORKER_TIMEOUT);

    pendingMap.set(requestId, { resolve, reject, timer });
    worker.stdin.write(JSON.stringify(cmdWithId) + "\n");
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
    // Unwrap envelope: Python returns { requestId, data: [...] } for list results
    res.json(result.data ?? result);
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
    // Unwrap envelope: Python returns { requestId, data: [...] } for list results
    res.json(result.data ?? result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── /api/noaa/gfs — Phase 3, Item 19 ──────────────────────────────────────────
// No authentication required — NOAA data is free and open
app.get("/api/noaa/gfs", async (req, res) => {
  const { south, north, west, east, forecastHours = 120 } = req.query;
  try {
    const result = await workerCall({
      action: "noaa_gfs",
      south: parseFloat(south), north: parseFloat(north),
      west:  parseFloat(west),  east:  parseFloat(east),
      forecast_hours: parseInt(forecastHours),
    });
    if (result.error) return res.status(500).json(result);
    res.json(result.data ?? result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── /api/noaa/wwiii — Phase 3, Item 20 ────────────────────────────────────────
app.get("/api/noaa/wwiii", async (req, res) => {
  const { south, north, west, east, forecastHours = 120 } = req.query;
  try {
    const result = await workerCall({
      action: "noaa_wwiii",
      south: parseFloat(south), north: parseFloat(north),
      west:  parseFloat(west),  east:  parseFloat(east),
      forecast_hours: parseInt(forecastHours),
    });
    if (result.error) return res.status(500).json(result);
    res.json(result.data ?? result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health",       (_, res) => res.json({ ok: true, server: "cmems-proxy", version: "2.1", workerReady }));
app.get("/api/cmems/health", (_, res) => res.json({ ok: true, server: "cmems-proxy", version: "2.1", workerReady }));

app.listen(PORT, () => console.log(`CMEMS proxy server running on http://localhost:${PORT}`));
