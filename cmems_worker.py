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
    import copernicusmarine, time
    t0 = time.time()
    # Use login(check_credentials_valid=True) — only hits the auth server,
    # no dataset open and no data download. ~3s vs ~60s for open_dataset.
    valid = copernicusmarine.login(
        username=user,
        password=password,
        check_credentials_valid=True,
        force_overwrite=False,
    )
    elapsed = round(time.time() - t0, 1)
    if not valid:
        return {"ok": False, "message": "Invalid credentials — check username and password."}
    return {"ok": True, "message": f"\u2713 CMEMS credentials valid ({elapsed}s)"}

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

# ── NOAA GFS handler — Phase 3, Item 19 ──────────────────────────────────────
# Fetches 10m wind (U/V → speed/dir) + MSLP from GFS 0.25° via NOMADS OPeNDAP.
# No API key required. Uses xarray + netCDF4 for direct OPeNDAP access.

def _gfs_latest_runs():
    """Yield (date_str, hour_str) for recent GFS runs, newest first.
    GFS runs at 00/06/12/18z; data available ~4.5h after run start."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    for hours_back in [5, 11, 17, 23, 29, 35]:
        candidate = now - timedelta(hours=hours_back)
        run_hour = (candidate.hour // 6) * 6
        yield candidate.strftime("%Y%m%d"), f"{run_hour:02d}"

def handle_noaa_gfs(cmd):
    import xarray as xr
    s, n = cmd["south"], cmd["north"]
    w, e = cmd["west"], cmd["east"]
    forecast_hours = cmd.get("forecast_hours", 120)
    max_steps = min(forecast_hours // 3, 40)  # GFS 0.25 is 3-hourly

    # Normalise longitudes to 0-360 for GFS grid
    w360 = w % 360 if w < 0 else w
    e360 = e % 360 if e < 0 else e

    last_err = None
    for run_date, run_hour in _gfs_latest_runs():
        url = f"https://nomads.ncep.noaa.gov/dods/gfs_0p25/gfs{run_date}/gfs_0p25_{run_hour}z"
        try:
            ds = xr.open_dataset(url, engine="netcdf4")
            sub = ds[["ugrd10m", "vgrd10m", "prmslmsl"]].isel(
                time=slice(0, max_steps)
            ).sel(lat=slice(s, n),
                  lon=slice(w360, e360) if w360 < e360 else slice(0, 360))

            lats = sub.lat.values.tolist()
            lons = sub.lon.values.tolist()
            import pandas as pd
            base_time = pd.Timestamp(f"{run_date} {run_hour}:00", tz="UTC")
            times_ms = []
            for t in sub.time.values:
                try:
                    times_ms.append(int(pd.Timestamp(t).timestamp() * 1000))
                except:
                    times_ms.append(int(base_time.timestamp() * 1000))

            out = []
            for li, lat in enumerate(lats):
                for loi, lon in enumerate(lons):
                    u_arr = sub["ugrd10m"].isel(lat=li, lon=loi).values
                    v_arr = sub["vgrd10m"].isel(lat=li, lon=loi).values
                    p_arr = sub["prmslmsl"].isel(lat=li, lon=loi).values
                    speed_kts, wind_dir, mslp = [], [], []
                    for ti in range(len(u_arr)):
                        u = float(u_arr[ti]) if math.isfinite(float(u_arr[ti])) else 0
                        v = float(v_arr[ti]) if math.isfinite(float(v_arr[ti])) else 0
                        spd_ms = math.sqrt(u*u + v*v)
                        speed_kts.append(round(spd_ms / 0.51444, 1))
                        d = (math.degrees(math.atan2(-u, -v)) + 360) % 360
                        wind_dir.append(round(d, 0))
                        p = float(p_arr[ti])
                        mslp.append(round(p / 100, 1) if math.isfinite(p) else None)
                    disp_lon = lon - 360 if lon > 180 else lon
                    out.append({
                        "lat": round(lat, 3), "lon": round(disp_lon, 3),
                        "times": times_ms, "source": "noaa_gfs",
                        "windKts": speed_kts, "windDir": wind_dir, "mslp": mslp,
                    })
            ds.close()
            return {"ok": True, "data": out,
                    "run": f"{run_date}/{run_hour}z",
                    "points": len(out), "steps": len(times_ms)}
        except Exception as exc:
            last_err = str(exc)
            continue
    return {"ok": False, "error": f"All GFS runs failed: {last_err}"}

# ── NOAA WaveWatch III handler — Phase 3, Item 20 ────────────────────────────
# Fetches wave model data (Hs, Tp, Dir) from NOMADS multi_1 product via OPeNDAP.
# WW3 uses 0.5° global grid, 3-hourly, updated 4x daily.

def _wwiii_latest_runs():
    """Yield (date_str, hour_str) for recent WW3 multi_1 runs."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    for hours_back in [6, 12, 18, 24, 30, 36]:
        candidate = now - timedelta(hours=hours_back)
        run_hour = (candidate.hour // 6) * 6
        yield candidate.strftime("%Y%m%d"), f"{run_hour:02d}"

def handle_noaa_wwiii(cmd):
    import xarray as xr
    s, n = cmd["south"], cmd["north"]
    w, e = cmd["west"], cmd["east"]
    forecast_hours = cmd.get("forecast_hours", 120)
    max_steps = min(forecast_hours // 3, 40)

    # WW3 multi_1 uses 0-360 longitude
    w360 = w % 360 if w < 0 else w
    e360 = e % 360 if e < 0 else e

    last_err = None
    for run_date, run_hour in _wwiii_latest_runs():
        url = f"https://nomads.ncep.noaa.gov/dods/wave/mww3/{run_date}/multi_1.glo_30m.{run_hour}z"
        try:
            ds = xr.open_dataset(url, engine="netcdf4")
            # WW3 variables: htsgwsfc (Hs), perpwsfc (peak period), dirpwsfc (peak dir)
            avail_vars = [v for v in ["htsgwsfc", "perpwsfc", "dirpwsfc"] if v in ds]
            if not avail_vars:
                last_err = "No wave variables found in dataset"
                ds.close()
                continue

            sub = ds[avail_vars].isel(time=slice(0, max_steps)).sel(
                lat=slice(s, n),
                lon=slice(w360, e360) if w360 < e360 else slice(0, 360))

            lats = sub.lat.values.tolist()
            lons = sub.lon.values.tolist()
            import pandas as pd
            base_time = pd.Timestamp(f"{run_date} {run_hour}:00", tz="UTC")
            times_ms = []
            for t in sub.time.values:
                try:
                    times_ms.append(int(pd.Timestamp(t).timestamp() * 1000))
                except:
                    times_ms.append(int(base_time.timestamp() * 1000))

            out = []
            for li, lat in enumerate(lats):
                for loi, lon in enumerate(lons):
                    pt = {"lat": round(lat, 3),
                          "lon": round((lon - 360 if lon > 180 else lon), 3),
                          "times": times_ms, "source": "noaa_wwiii"}
                    if "htsgwsfc" in sub:
                        pt["waveHeight"] = arr_clean(
                            sub["htsgwsfc"].isel(lat=li, lon=loi).values.tolist())
                    if "perpwsfc" in sub:
                        pt["wavePeriod"] = arr_clean(
                            sub["perpwsfc"].isel(lat=li, lon=loi).values.tolist())
                    if "dirpwsfc" in sub:
                        pt["waveDir"] = arr_clean(
                            sub["dirpwsfc"].isel(lat=li, lon=loi).values.tolist(), 0)
                    out.append(pt)

            ds.close()
            return {"ok": True, "data": out,
                    "run": f"{run_date}/{run_hour}z",
                    "points": len(out), "steps": len(times_ms)}
        except Exception as exc:
            last_err = str(exc)
            continue
    return {"ok": False, "error": f"All WW3 runs failed: {last_err}"}

# ── Main loop — read one JSON command per line, write one JSON result ──────────
HANDLERS = {"test": handle_test, "wave": handle_wave, "physics": handle_physics,
            "noaa_gfs": handle_noaa_gfs, "noaa_wwiii": handle_noaa_wwiii}

print(json.dumps({"ready": True}), flush=True)

for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        cmd = json.loads(raw)
        # Echo requestId back so the Node.js caller can route the response to
        # the correct Promise — prevents data corruption under concurrent requests.
        request_id = cmd.get("requestId")
        handler = HANDLERS.get(cmd.get("action", ""))
        if not handler:
            out = {"error": f"Unknown action: {cmd.get('action')}"}
            if request_id is not None:
                out["requestId"] = request_id
            print(json.dumps(out), flush=True)
            continue
        result = handler(cmd)
        # Wrap list results in an envelope so requestId is always at the top level
        if isinstance(result, list):
            out = {"requestId": request_id, "data": result}
        else:
            out = {**result, "requestId": request_id}
        print(json.dumps(out), flush=True)
    except Exception as exc:
        import traceback
        out = {"error": str(exc), "tb": traceback.format_exc()}
        if "request_id" in dir() and request_id is not None:
            out["requestId"] = request_id
        print(json.dumps(out), flush=True)
