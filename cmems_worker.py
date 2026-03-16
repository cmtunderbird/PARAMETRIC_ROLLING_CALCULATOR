# cmems_worker.py — Persistent CMEMS data worker
# Reads JSON commands from stdin, writes JSON results to stdout.
# Keeps copernicusmarine dataset handles open in memory between requests.
# Started once by cmems-server.js on startup; never restarted per-request.

import sys, json, os, warnings, math
warnings.filterwarnings("ignore")

import numpy as np

# ── Dataset handle cache: (dataset_id, user) → open xarray Dataset ────────────
_ds_cache = {}

def open_ds(dataset_id, user, password):
    key = (dataset_id, user)
    if key not in _ds_cache:
        os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = user
        os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = password
        import copernicusmarine
        _ds_cache[key] = copernicusmarine.open_dataset(dataset_id=dataset_id)
    return _ds_cache[key]

# ── Helpers ───────────────────────────────────────────────────────────────────
def clean(v):
    if v is None: return None
    try:
        f = float(v)
        return None if not math.isfinite(f) else round(f, 4)
    except: return None

def arr_clean(a, decimals=3):
    return [None if (v is None or (isinstance(v, float) and not math.isfinite(v)))
            else round(float(v), decimals) for v in a]

# ── Command handlers ──────────────────────────────────────────────────────────

def handle_test(cmd):
    user, password = cmd["user"], cmd["password"]
    import copernicusmarine
    os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = user
    os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = password
    ds = open_ds("cmems_mod_glo_wav_anfc_0.083deg_PT3H-i", user, password)
    sub = ds["VHM0"].sel(
        latitude=slice(37.9, 38.1), longitude=slice(-28.1, -27.9)
    ).isel(time=0)
    v = float(sub.values.flat[0])
    return {"ok": True, "hs": round(v, 2),
            "message": f"Connected — test Hs = {round(v,2)} m at 38\u00b0N 28\u00b0W"}

def handle_wave(cmd):
    user, password = cmd["user"], cmd["password"]
    s, n, w, e = cmd["south"], cmd["north"], cmd["west"], cmd["east"]
    start, end = cmd["start"], cmd["end"]
    WAVE_VARS = {
        "VHM0":"waveHeight","VMDR":"waveDir","VTM10":"wavePeriod",
        "VHM0_WW":"windWaveH","VTM01_WW":"windWaveT","VMDR_WW":"windWaveDir",
        "VHM0_SW1":"swellHeight","VTM01_SW1":"swellPeriod","VMDR_SW1":"swellDir",
    }
    ds = open_ds("cmems_mod_glo_wav_anfc_0.083deg_PT3H-i", user, password)
    sub = ds[list(WAVE_VARS.keys())].sel(
        latitude=slice(s, n), longitude=slice(w, e),
        time=slice(start, end)
    )
    lats  = sub.latitude.values.tolist()
    lons  = sub.longitude.values.tolist()
    times = [int(t.astype("int64") // 1_000_000) for t in sub.time.values]
    out = []
    for li, lat in enumerate(lats):
        for loi, lon in enumerate(lons):
            pt = {"lat": round(lat,3), "lon": round(lon,3),
                  "times": times, "source": "cmems"}
            for var, key in WAVE_VARS.items():
                if var in sub:
                    pt[key] = arr_clean(
                        sub[var].isel(latitude=li, longitude=loi).values.tolist()
                    )
            out.append(pt)
    return out

def handle_physics(cmd):
    user, password = cmd["user"], cmd["password"]
    s, n, w, e = cmd["south"], cmd["north"], cmd["west"], cmd["east"]
    start, end = cmd["start"], cmd["end"]
    ds = open_ds("cmems_mod_glo_phy_anfc_0.083deg_PT1H-m", user, password)
    sub = ds[["uo","vo","thetao"]].sel(
        latitude=slice(s, n), longitude=slice(w, e),
        time=slice(start, end)
    )
    if "depth" in sub.dims:
        sub = sub.isel(depth=0)
    lats  = sub.latitude.values.tolist()
    lons  = sub.longitude.values.tolist()
    times = [int(t.astype("int64") // 1_000_000) for t in sub.time.values]
    out = []
    for li, lat in enumerate(lats):
        for loi, lon in enumerate(lons):
            pt = {"lat": round(lat,3), "lon": round(lon,3),
                  "times": times, "source": "cmems_phy"}
            for var, key in [("uo","currentU"),("vo","currentV"),("thetao","sst")]:
                if var in sub:
                    pt[key] = arr_clean(
                        sub[var].isel(latitude=li, longitude=loi).values.tolist(), 4
                    )
            if "currentU" in pt and "currentV" in pt:
                pt["currentSpeed"] = [
                    round(math.sqrt(u**2+v**2), 4)
                    if u is not None and v is not None else None
                    for u, v in zip(pt["currentU"], pt["currentV"])
                ]
                pt["currentDir"] = [
                    round((math.degrees(math.atan2(u, v)) + 360) % 360, 1)
                    if u is not None and v is not None else None
                    for u, v in zip(pt["currentU"], pt["currentV"])
                ]
            out.append(pt)
    return out

# ── Main loop — read one JSON command per line, write one JSON result ──────────
HANDLERS = {"test": handle_test, "wave": handle_wave, "physics": handle_physics}

print(json.dumps({"ready": True}), flush=True)

for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        cmd = json.loads(raw)
        handler = HANDLERS.get(cmd.get("action",""))
        if not handler:
            print(json.dumps({"error": f"Unknown action: {cmd.get('action')}"}), flush=True)
            continue
        result = handler(cmd)
        print(json.dumps(result), flush=True)
    except Exception as exc:
        import traceback
        print(json.dumps({"error": str(exc), "tb": traceback.format_exc()}), flush=True)
