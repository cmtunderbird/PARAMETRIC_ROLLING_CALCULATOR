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
        # Redirect stdout → stderr: copernicusmarine prints progress to stdout
        # which corrupts our JSON stdin/stdout protocol
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            _ds_cache[key] = copernicusmarine.open_dataset(dataset_id=dataset_id)
        finally:
            sys.stdout = old_stdout
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
    # Pre-warm dataset handles in background thread (non-blocking)
    import threading
    def _warmup():
        try:
            sys.stderr.write("[warmup] Opening wave dataset...\n")
            open_ds("cmems_mod_glo_wav_anfc_0.083deg_PT3H-i", user, password)
            sys.stderr.write("[warmup] Wave dataset ready. Opening physics dataset...\n")
            open_ds("cmems_mod_glo_phy_anfc_0.083deg_PT1H-m", user, password)
            sys.stderr.write("[warmup] Physics dataset ready.\n")
        except Exception as exc:
            sys.stderr.write(f"[warmup] Error: {exc}\n")
    threading.Thread(target=_warmup, daemon=True).start()
    return {"ok": True, "message": f"\u2713 CMEMS credentials valid ({elapsed}s) — datasets warming up in background"}

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
    """Fetch ocean currents using copernicusmarine.subset() — downloads NetCDF file.
    Much more reliable than open_dataset() OPeNDAP streaming for first-time use."""
    import copernicusmarine, tempfile, xarray as xr
    user, password = cmd["user"], cmd["password"]
    s, n, w, e = cmd["south"], cmd["north"], cmd["west"], cmd["east"]
    start, end = cmd["start"], cmd["end"]
    dataset_id = "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m"
    sys.stderr.write(f"[physics] subset download: {dataset_id}\n")
    sys.stderr.write(f"[physics] bounds: s={s} n={n} w={w} e={e} time={start}..{end}\n")
    os.environ["COPERNICUSMARINE_SERVICE_USERNAME"] = user
    os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"] = password
    # Download to temp file — avoids OPeNDAP streaming timeout
    # CRITICAL: redirect stdout to stderr during subset() call —
    # copernicusmarine prints progress to stdout which corrupts our JSON protocol
    tmpdir = tempfile.mkdtemp(prefix="prc_cmems_cur_")
    outfile = os.path.join(tmpdir, "currents.nc")
    try:
        old_stdout = sys.stdout
        sys.stdout = sys.stderr  # redirect all subset() output to stderr
        try:
            copernicusmarine.subset(
                dataset_id=dataset_id,
                variables=["uo", "vo"],
                minimum_latitude=s, maximum_latitude=n,
                minimum_longitude=w, maximum_longitude=e,
                start_datetime=start, end_datetime=end,
                minimum_depth=0, maximum_depth=1,
                output_filename="currents.nc",
                output_directory=tmpdir,
            )
        finally:
            sys.stdout = old_stdout  # always restore stdout
        sys.stderr.write(f"[physics] file downloaded: {outfile} ({os.path.getsize(outfile)} bytes)\n")
        ds = xr.open_dataset(outfile)
    except Exception as exc:
        sys.stderr.write(f"[physics] subset failed: {exc}\n")
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
    # Extract data from downloaded NetCDF
    if "depth" in ds.dims:
        ds = ds.isel(depth=0)
    lats = ds.latitude.values.tolist()
    lons = ds.longitude.values.tolist()
    times = [int(t.astype("int64") // 1_000_000) for t in ds.time.values]
    sys.stderr.write(f"[physics] data: {len(lats)} lats x {len(lons)} lons x {len(times)} times\n")
    out = []
    diag = {"lats": len(lats), "lons": len(lons), "times": len(times),
            "bounds": {"s": s, "n": n, "w": w, "e": e},
            "timeRange": {"start": start, "end": end}}
    for li, lat in enumerate(lats):
        for loi, lon in enumerate(lons):
            pt = {"lat": round(float(lat), 3), "lon": round(float(lon), 3),
                  "times": times, "source": "cmems_phy"}
            for var, key in [("uo", "currentU"), ("vo", "currentV")]:
                if var in ds:
                    pt[key] = arr_clean(
                        ds[var].isel(latitude=li, longitude=loi).values.tolist(), 4
                    )
            if "currentU" in pt and "currentV" in pt:
                pt["currentSpeed"] = [
                    round(math.sqrt(u**2 + v**2), 4)
                    if u is not None and v is not None else None
                    for u, v in zip(pt["currentU"], pt["currentV"])
                ]
                pt["currentDir"] = [
                    round((math.degrees(math.atan2(u, v)) + 360) % 360, 1)
                    if u is not None and v is not None else None
                    for u, v in zip(pt["currentU"], pt["currentV"])
                ]
            out.append(pt)
    ds.close()
    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)
    sys.stderr.write(f"[physics] returning {len(out)} grid points\n")
    return {"data": out, "diag": diag}

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

            # Decode all GRIB2 files — open TWICE per file:
            # once for 10m wind (heightAboveGround), once for MSLP (meanSea)
            # cfgrib can't mix level types in a single open_dataset call.
            for fh_idx, fh in enumerate(fhours):
                dest = os.path.join(tmpdir, f"gfs_f{fh:03d}.grib2")
                wind_ds, pres_ds = None, None
                # Try opening with filter_by_keys for wind (10m above ground)
                for wind_keys in [
                    {"typeOfLevel": "heightAboveGround", "level": 10},
                    {"typeOfLevel": "heightAboveGround"},
                    {},  # fallback: no filter
                ]:
                    try:
                        wind_ds = xr.open_dataset(dest, engine="cfgrib",
                            backend_kwargs={"indexpath": "", "filter_by_keys": wind_keys})
                        if any(v in wind_ds for v in ["u10","v10","10u","10v","u","v"]):
                            break
                        wind_ds.close(); wind_ds = None
                    except:
                        wind_ds = None
                # Try opening with filter_by_keys for MSLP
                for pres_keys in [
                    {"typeOfLevel": "meanSea"},
                    {"typeOfLevel": "heightAboveSea"},
                    {},
                ]:
                    try:
                        pres_ds = xr.open_dataset(dest, engine="cfgrib",
                            backend_kwargs={"indexpath": "", "filter_by_keys": pres_keys})
                        if any(v in pres_ds for v in ["prmsl","msl","mslet","sp"]):
                            break
                        pres_ds.close(); pres_ds = None
                    except:
                        pres_ds = None
                if wind_ds is not None or pres_ds is not None:
                    all_ds.append((fh_idx, wind_ds, pres_ds))
                # Log variable names from first file for diagnostics
                if fh_idx == 0:
                    wvars = list(wind_ds.data_vars) if wind_ds else []
                    pvars = list(pres_ds.data_vars) if pres_ds else []
                    sys.stderr.write(f"[GFS] wind vars: {wvars}, pres vars: {pvars}\n")

            if not all_ds:
                raise ValueError("No GRIB2 files decoded successfully")

            # Extract grid from first available dataset
            sample = all_ds[0][1] or all_ds[0][2]
            lats = sample.latitude.values.tolist()
            lons = sample.longitude.values.tolist()

            # Discover actual variable names from first file
            wds0 = all_ds[0][1]
            pds0 = all_ds[0][2]
            u_var = next((v for v in ["u10","10u","u"] if wds0 and v in wds0), None)
            v_var = next((v for v in ["v10","10v","v"] if wds0 and v in wds0), None)
            p_var = next((v for v in ["prmsl","msl","mslet","sp"] if pds0 and v in pds0), None)
            sys.stderr.write(f"[GFS] using u={u_var} v={v_var} p={p_var}\n")

            out = []
            for lat in lats:
                for lon in lons:
                    speed_kts, wind_dir_arr, mslp = [], [], []
                    for fh_idx, wds, pds in all_ds:
                        u, v = 0, 0
                        if wds and u_var and v_var:
                            try:
                                u = float(wds[u_var].sel(latitude=lat, longitude=lon, method="nearest").values)
                                v = float(wds[v_var].sel(latitude=lat, longitude=lon, method="nearest").values)
                            except:
                                u, v = 0, 0
                        spd = math.sqrt(u*u + v*v)
                        speed_kts.append(round(spd / 0.51444, 1))
                        d = (math.degrees(math.atan2(-u, -v)) + 360) % 360
                        wind_dir_arr.append(round(d, 0))
                        if pds and p_var:
                            try:
                                p = float(pds[p_var].sel(latitude=lat, longitude=lon, method="nearest").values)
                                mslp.append(round(p / 100, 1) if math.isfinite(p) else None)
                            except:
                                mslp.append(None)
                        else:
                            mslp.append(None)
                    disp_lon = lon - 360 if lon > 180 else lon
                    out.append({
                        "lat": round(lat, 3), "lon": round(disp_lon, 3),
                        "times": times_ms, "source": "noaa_gfs",
                        "windKts": speed_kts, "windDir": wind_dir_arr, "mslp": mslp,
                    })

            # Cleanup
            for _, wds, pds in all_ds:
                if wds: wds.close()
                if pds: pds.close()
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

def handle_warmup(cmd):
    """Open both CMEMS datasets to cache handles. Slow first time (~5min)."""
    user, password = cmd["user"], cmd["password"]
    import time
    results = {}
    for name, dsid in [("wave", "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"),
                        ("physics", "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m")]:
        t0 = time.time()
        try:
            open_ds(dsid, user, password)
            results[name] = {"ok": True, "elapsed": round(time.time() - t0, 1)}
            sys.stderr.write(f"[warmup] {name} dataset ready in {results[name]['elapsed']}s\n")
        except Exception as e:
            results[name] = {"ok": False, "error": str(e), "elapsed": round(time.time() - t0, 1)}
            sys.stderr.write(f"[warmup] {name} dataset FAILED: {e}\n")
    return {"ok": True, "datasets": results}

# ── Main loop — read one JSON command per line, write one JSON result ──────────
HANDLERS = {"test": handle_test, "wave": handle_wave, "physics": handle_physics,
            "warmup": handle_warmup,
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
