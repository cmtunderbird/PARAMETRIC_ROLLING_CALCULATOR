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

# ── NOAA GFS handler — GRIB filter replacement (OPeNDAP retired Feb 2026) ────
# Fetches 10m wind (U/V → speed/dir) + MSLP from GFS 0.25° via NOMADS GRIB filter.
# Each forecast hour is a separate HTTP request returning a small subsetted GRIB2 file.
# Decoded with xarray + cfgrib backend.

import tempfile, urllib.request, time as _time

def _gfs_latest_runs():
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    for hours_back in [5, 11, 17, 23, 29, 35]:
        candidate = now - timedelta(hours=hours_back)
        run_hour = (candidate.hour // 6) * 6
        yield candidate.strftime("%Y%m%d"), f"{run_hour:02d}"

def _download_grib(url, dest):
    """Download a GRIB2 file from NOMADS GRIB filter."""
    req = urllib.request.Request(url, headers={"User-Agent": "PRC/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
        if b"<!doctype" in data[:200].lower() or b"<html" in data[:200].lower():
            raise ValueError("Server returned HTML instead of GRIB2 — run may not be available yet")
        with open(dest, "wb") as f:
            f.write(data)
    return dest

def handle_noaa_gfs(cmd):
    import xarray as xr
    s, n = cmd["south"], cmd["north"]
    w, e = cmd["west"], cmd["east"]
    forecast_hours = cmd.get("forecast_hours", 120)
    # Fetch every 6h for speed (0,6,12,...,120 = 21 files)
    step = 6
    fhours = list(range(0, min(forecast_hours, 121), step))

    last_err = None
    for run_date, run_hour in _gfs_latest_runs():
        tmpdir = tempfile.mkdtemp(prefix="prc_gfs_")
        try:
            all_ds = []
            times_ms = []
            import pandas as pd
            base = pd.Timestamp(f"{run_date} {run_hour}:00", tz="UTC")

            for fh in fhours:
                fname = f"gfs.t{run_hour}z.pgrb2.0p25.f{fh:03d}"
                url = (f"https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?"
                       f"dir=/gfs.{run_date}/{run_hour}/atmos&file={fname}"
                       f"&var_UGRD=on&var_VGRD=on&var_PRMSL=on"
                       f"&lev_10_m_above_ground=on&lev_mean_sea_level=on"
                       f"&subregion=&toplat={n}&leftlon={w}&rightlon={e}&bottomlat={s}")
                dest = os.path.join(tmpdir, f"gfs_f{fh:03d}.grib2")
                _download_grib(url, dest)
                times_ms.append(int((base + pd.Timedelta(hours=fh)).timestamp() * 1000))
                _time.sleep(0.5)  # NOMADS rate limit

            # Decode all GRIB2 files
            for fh_idx, fh in enumerate(fhours):
                dest = os.path.join(tmpdir, f"gfs_f{fh:03d}.grib2")
                try:
                    ds = xr.open_dataset(dest, engine="cfgrib",
                        backend_kwargs={"indexpath": ""})
                    all_ds.append((fh_idx, ds))
                except Exception as ex:
                    continue

            if not all_ds:
                raise ValueError("No GRIB2 files decoded successfully")

            # Extract grid from first file
            sample = all_ds[0][1]
            lats = sample.latitude.values.tolist()
            lons = sample.longitude.values.tolist()

            out = []
            for lat in lats:
                for lon in lons:
                    speed_kts, wind_dir, mslp = [], [], []
                    for fh_idx, ds in all_ds:
                        try:
                            u = float(ds["u10"].sel(latitude=lat, longitude=lon, method="nearest").values)
                            v = float(ds["v10"].sel(latitude=lat, longitude=lon, method="nearest").values)
                        except:
                            try:
                                u = float(ds["u"].sel(latitude=lat, longitude=lon, method="nearest").values)
                                v = float(ds["v"].sel(latitude=lat, longitude=lon, method="nearest").values)
                            except:
                                u, v = 0, 0
                        spd = math.sqrt(u*u + v*v)
                        speed_kts.append(round(spd / 0.51444, 1))
                        d = (math.degrees(math.atan2(-u, -v)) + 360) % 360
                        wind_dir.append(round(d, 0))
                        try:
                            p = float(ds["prmsl"].sel(latitude=lat, longitude=lon, method="nearest").values)
                            mslp.append(round(p / 100, 1) if math.isfinite(p) else None)
                        except:
                            try:
                                p = float(ds["msl"].sel(latitude=lat, longitude=lon, method="nearest").values)
                                mslp.append(round(p / 100, 1) if math.isfinite(p) else None)
                            except:
                                mslp.append(None)
                    disp_lon = lon - 360 if lon > 180 else lon
                    out.append({
                        "lat": round(lat, 3), "lon": round(disp_lon, 3),
                        "times": times_ms, "source": "noaa_gfs",
                        "windKts": speed_kts, "windDir": wind_dir, "mslp": mslp,
                    })

            # Cleanup
            for _, ds in all_ds:
                ds.close()
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

            return {"ok": True, "data": out,
                    "run": f"{run_date}/{run_hour}z",
                    "points": len(out), "steps": len(times_ms)}
        except Exception as exc:
            last_err = str(exc)
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
            continue
    return {"ok": False, "error": f"All GFS runs failed: {last_err}"}

# ── NOAA WaveWatch III — GRIB filter replacement ─────────────────────────────
def _wwiii_latest_runs():
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
    step = 6
    fhours = list(range(0, min(forecast_hours, 121), step))

    # WW3 uses 0-360 longitude
    w360 = w % 360 if w < 0 else w
    e360 = e % 360 if e < 0 else e

    last_err = None
    for run_date, run_hour in _wwiii_latest_runs():
        tmpdir = tempfile.mkdtemp(prefix="prc_ww3_")
        try:
            times_ms = []
            import pandas as pd
            base = pd.Timestamp(f"{run_date} {run_hour}:00", tz="UTC")

            for fh in fhours:
                fname = f"multi_1.glo_30m.t{run_hour}z.f{fh:03d}.grib2"
                url = (f"https://nomads.ncep.noaa.gov/cgi-bin/filter_wave_multi.pl?"
                       f"dir=/multi_1.{run_date}&file={fname}"
                       f"&var_HTSGW=on&var_PERPW=on&var_DIRPW=on"
                       f"&lev_surface=on"
                       f"&subregion=&toplat={n}&leftlon={w360}&rightlon={e360}&bottomlat={s}")
                dest = os.path.join(tmpdir, f"ww3_f{fh:03d}.grib2")
                _download_grib(url, dest)
                times_ms.append(int((base + pd.Timedelta(hours=fh)).timestamp() * 1000))
                _time.sleep(0.5)

            all_ds = []
            for fh_idx, fh in enumerate(fhours):
                dest = os.path.join(tmpdir, f"ww3_f{fh:03d}.grib2")
                try:
                    ds = xr.open_dataset(dest, engine="cfgrib",
                        backend_kwargs={"indexpath": ""})
                    all_ds.append((fh_idx, ds))
                except:
                    continue

            if not all_ds:
                raise ValueError("No WW3 GRIB2 files decoded successfully")

            sample = all_ds[0][1]
            lats = sample.latitude.values.tolist()
            lons = sample.longitude.values.tolist()

            out = []
            for lat in lats:
                for lon in lons:
                    hs_arr, tp_arr, dir_arr = [], [], []
                    for fh_idx, ds in all_ds:
                        try:
                            hs = float(ds["swh"].sel(latitude=lat, longitude=lon, method="nearest").values)
                            hs_arr.append(round(hs, 2) if math.isfinite(hs) else None)
                        except:
                            hs_arr.append(None)
                        try:
                            tp = float(ds["perpw"].sel(latitude=lat, longitude=lon, method="nearest").values)
                            tp_arr.append(round(tp, 1) if math.isfinite(tp) else None)
                        except:
                            tp_arr.append(None)
                        try:
                            dr = float(ds["dirpw"].sel(latitude=lat, longitude=lon, method="nearest").values)
                            dir_arr.append(round(dr, 0) if math.isfinite(dr) else None)
                        except:
                            dir_arr.append(None)
                    disp_lon = lon - 360 if lon > 180 else lon
                    out.append({
                        "lat": round(lat, 3), "lon": round(disp_lon, 3),
                        "times": times_ms, "source": "noaa_wwiii",
                        "waveHeight": hs_arr, "wavePeriod": tp_arr, "waveDir": dir_arr,
                    })

            for _, ds in all_ds:
                ds.close()
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

            return {"ok": True, "data": out,
                    "run": f"{run_date}/{run_hour}z",
                    "points": len(out), "steps": len(times_ms)}
        except Exception as exc:
            last_err = str(exc)
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)
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
