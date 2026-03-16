// ─── cmems-server.js ───────────────────────────────────────────────────────────
// Local Express proxy that bridges the browser to the new Copernicus Marine
// Toolbox (copernicusmarine v2.x).
//
// Since April 2024 the old nrt.cmems-du.eu THREDDS/OPeNDAP service is dead.
// The new API is Python-only (copernicusmarine package).  This server:
//   1. Accepts bbox+variable requests from the browser over HTTP (no CORS issue)
//   2. Spawns a Python one-liner using the installed copernicusmarine package
//   3. Returns JSON grid data to the browser
//
// Start: node cmems-server.js  (runs on http://localhost:5174)
// The launch.bat starts this automatically alongside Vite.

import express    from "express";
import cors       from "cors";
import { spawn }  from "child_process";
import fs         from "fs";
import path       from "path";
import os         from "os";

const app  = express();
const PORT = 5174;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Python CMEMS fetch helper ─────────────────────────────────────────────────
function runPython(script) {
  return new Promise((resolve, reject) => {
    const py = spawn("python", ["-c", script]);
    let out = "", err = "";
    py.stdout.on("data", d => out += d.toString());
    py.stderr.on("data", d => err += d.toString());
    py.on("close", code => {
      if (code !== 0) reject(new Error(err || `Python exited ${code}`));
      else resolve(out.trim());
    });
    setTimeout(() => { py.kill(); reject(new Error("Python timeout (60s)")); }, 60000);
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

// ── /api/cmems/test — credential + connectivity check ────────────────────────
app.get("/api/cmems/test", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.status(401).json({ ok: false, message: "Missing or invalid Authorization header." });
  const { user, pass } = creds;

  const script = `
import os, json
os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = ${JSON.stringify(user)}
os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = ${JSON.stringify(pass)}
import copernicusmarine
try:
    ds = copernicusmarine.open_dataset(
        dataset_id="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        variables=["VHM0"],
        minimum_longitude=-28.1, maximum_longitude=-27.9,
        minimum_latitude=37.9,  maximum_latitude=38.1,
        minimum_depth=0, maximum_depth=1,
    )
    v = float(ds["VHM0"].values.flat[0])
    print(json.dumps({"ok": True, "hs": round(v,2)}))
except Exception as e:
    print(json.dumps({"ok": False, "message": str(e)}))
`;
  try {
    const out = await runPython(script);
    const result = JSON.parse(out);
    if (result.ok) result.message = `✓ CMEMS v2 connected — test Hs = ${result.hs} m at 38°N 28°W`;
    res.json(result);
  } catch(e) { res.json({ ok: false, message: e.message }); }
});

// ── /api/cmems/wave — wave grid for a bounding box ───────────────────────────
app.get("/api/cmems/wave", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.status(401).json({ error: "Missing Authorization header" });
  const { user, pass } = creds;
  const { south, north, west, east, forecastDays = 7 } = req.query;

  // Work out time range: now → now + forecastDays
  const now  = new Date();
  const end  = new Date(now.getTime() + parseInt(forecastDays) * 86400000);
  const fmt  = d => d.toISOString().slice(0,19);

  const script = `
import os, json, warnings; warnings.filterwarnings("ignore")
os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = ${JSON.stringify(user)}
os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = ${JSON.stringify(pass)}
import copernicusmarine, numpy as np
try:
    ds = copernicusmarine.open_dataset(
        dataset_id="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        variables=["VHM0","VMDR","VTM10","VHM0_WW","VTM01_WW","VMDR_WW","VHM0_SW1","VTM01_SW1","VMDR_SW1"],
        minimum_longitude=${parseFloat(west)},  maximum_longitude=${parseFloat(east)},
        minimum_latitude=${parseFloat(south)}, maximum_latitude=${parseFloat(north)},
        start_datetime="${fmt(now)}", end_datetime="${fmt(end)}",
    )
    lats = ds.latitude.values.tolist()
    lons = ds.longitude.values.tolist()
    times = [int(t.astype("int64")//1e6) for t in ds.time.values]
    out = []
    def safe(arr):
        a = arr.values
        a = np.where(np.isfinite(a), a, None)
        return a.tolist()
    for li, lat in enumerate(lats):
        for loi, lon in enumerate(lons):
            pt = {"lat": round(lat,3), "lon": round(lon,3), "times": times, "source": "cmems"}
            for var, key in [("VHM0","waveHeight"),("VMDR","waveDir"),("VTM10","wavePeriod"),
                             ("VHM0_WW","windWaveH"),("VTM01_WW","windWaveT"),("VMDR_WW","windWaveDir"),
                             ("VHM0_SW1","swellHeight"),("VTM01_SW1","swellPeriod"),("VMDR_SW1","swellDir")]:
                if var in ds:
                    arr = ds[var].isel(latitude=li, longitude=loi).values.tolist()
                    pt[key] = [None if (v is None or (isinstance(v,float) and not np.isfinite(v))) else round(float(v),3) for v in arr]
            out.append(pt)
    print(json.dumps(out))
except Exception as e:
    import traceback; print(json.dumps({"error": str(e), "tb": traceback.format_exc()}))
`;
  try {
    const raw = await runPython(script);
    const result = JSON.parse(raw);
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── /api/cmems/physics — currents + SST ──────────────────────────────────────
app.get("/api/cmems/physics", async (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.status(401).json({ error: "Missing Authorization header" });
  const { user, pass } = creds;
  const { south, north, west, east } = req.query;

  const now = new Date();
  const end = new Date(now.getTime() + 2 * 86400000); // 2-day physics forecast
  const fmt = d => d.toISOString().slice(0,19);

  const script = `
import os, json, warnings; warnings.filterwarnings("ignore")
os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = ${JSON.stringify(user)}
os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = ${JSON.stringify(pass)}
import copernicusmarine, numpy as np
try:
    ds = copernicusmarine.open_dataset(
        dataset_id="cmems_mod_glo_phy_anfc_0.083deg_PT1H-m",
        variables=["uo","vo","thetao"],
        minimum_longitude=${parseFloat(west)},  maximum_longitude=${parseFloat(east)},
        minimum_latitude=${parseFloat(south)}, maximum_latitude=${parseFloat(north)},
        minimum_depth=0, maximum_depth=1,
        start_datetime="${fmt(now)}", end_datetime="${fmt(end)}",
    )
    lats  = ds.latitude.values.tolist()
    lons  = ds.longitude.values.tolist()
    times = [int(t.astype("int64")//1e6) for t in ds.time.values]
    out = []
    for li, lat in enumerate(lats):
        for loi, lon in enumerate(lons):
            pt = {"lat": round(lat,3), "lon": round(lon,3), "times": times, "source": "cmems_phy"}
            for var, key in [("uo","currentU"),("vo","currentV"),("thetao","sst")]:
                if var in ds:
                    sl = ds[var].isel(latitude=li, longitude=loi)
                    if "depth" in sl.dims: sl = sl.isel(depth=0)
                    arr = sl.values.tolist()
                    pt[key] = [None if not np.isfinite(v) else round(float(v),4) for v in arr]
            # derive speed + direction from u/v
            if "currentU" in pt and "currentV" in pt:
                import math
                pt["currentSpeed"] = [round(math.sqrt(u**2+v**2),4) if u is not None and v is not None else None for u,v in zip(pt["currentU"],pt["currentV"])]
                pt["currentDir"]   = [round((math.degrees(math.atan2(u,v))+360)%360,1) if u is not None and v is not None else None for u,v in zip(pt["currentU"],pt["currentV"])]
            out.append(pt)
    print(json.dumps(out))
except Exception as e:
    import traceback; print(json.dumps({"error": str(e), "tb": traceback.format_exc()}))
`;
  try {
    const raw = await runPython(script);
    const result = JSON.parse(raw);
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/health",       (_, res) => res.json({ ok: true, server: "cmems-proxy", version: "2.0" }));
app.get("/api/cmems/health", (_, res) => res.json({ ok: true, server: "cmems-proxy", version: "2.0" }));

app.listen(PORT, () => console.log(`CMEMS proxy server running on http://localhost:${PORT}`));
