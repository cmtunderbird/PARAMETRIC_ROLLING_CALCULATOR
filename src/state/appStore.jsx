// ─── appStore.js — Centralised state with localStorage persistence ───────────
// Phase 1, Item 3
// React Context + useReducer replaces 30+ scattered useState calls in App.jsx.
// Persists vessel config, position, speed/heading, and preferences to localStorage
// so the incoming OOW sees the previous assessment on app launch.
import { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { decimalToNautical } from "../ui/components/NauticalCoord.jsx";

// ─── Vessel Profiles (Phase 1, Item 9) ───────────────────────────────────────
import vesselProfiles from "../core/vesselProfiles.json";

// Build PRESETS from profiles (backward-compatible shape for UI consumers)
export const PRESETS = Object.fromEntries(
  Object.entries(vesselProfiles).map(([key, p]) => [key, {
    name: p.name, Lwl: p.Lwl, B: p.B, d: p.d, GM: p.GM, Cb: p.Cb,
    rollDamping: p.rollDamping,
    bowFreeboard: p.bowFreeboard, fp_from_midship: p.fp_from_midship,
    bridge_from_midship: p.bridge_from_midship,
  }])
);

// Full profiles with conditions/notes for VesselConfig panel
export { vesselProfiles };

// ─── localStorage persistence keys ──────────────────────────────────────────
const STORAGE_KEY = "prc_app_state";

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function persistState(state) {
  try {
    // Only persist the fields that matter across sessions
    const toSave = {
      preset: state.preset,
      ship: state.ship,
      speed: state.speed,
      heading: state.heading,
      locationKey: state.locationKey,
      latDeg: state.latDeg, latMin: state.latMin, latHemi: state.latHemi,
      lonDeg: state.lonDeg, lonMin: state.lonMin, lonHemi: state.lonHemi,
      activeSources: state.activeSources,
      activeTab: state.activeTab,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded or private mode — fail silently */ }
}

// ─── Default initial state ──────────────────────────────────────────────────
function makeInitialState() {
  const saved = loadPersistedState();
  return {
    activeTab:    saved?.activeTab    ?? "dashboard",
    preset:       saved?.preset       ?? "container_large",
    ship:         saved?.ship         ?? { ...PRESETS.container_large },
    speed:        saved?.speed        ?? 18,
    heading:      saved?.heading      ?? 0,
    locationKey:  saved?.locationKey  ?? "North Atlantic",
    latDeg:       saved?.latDeg       ?? 50,
    latMin:       saved?.latMin       ?? 0.0,
    latHemi:      saved?.latHemi      ?? "N",
    lonDeg:       saved?.lonDeg       ?? 30,
    lonMin:       saved?.lonMin       ?? 0.0,
    lonHemi:      saved?.lonHemi      ?? "W",
    activeSources: saved?.activeSources ?? ["open-meteo-marine", "open-meteo-weather"],
    // Transient state — NOT persisted
    marineData:   null,
    windData:     null,
    loading:      false,
    error:        null,
    hourIdx:      0,
    lastFetch:    null,
  };
}

// ─── Reducer ────────────────────────────────────────────────────────────────
function appReducer(state, action) {
  switch (action.type) {
    case "SET_TAB":         return { ...state, activeTab: action.value };
    case "SET_SPEED":       return { ...state, speed: action.value };
    case "SET_HEADING":     return { ...state, heading: action.value };
    case "SET_HOUR_IDX":    return { ...state, hourIdx: action.value };
    case "SET_LOADING":     return { ...state, loading: action.value };
    case "SET_ERROR":       return { ...state, error: action.value };
    case "SET_LAST_FETCH":  return { ...state, lastFetch: action.value };
    case "SET_MARINE_DATA": return { ...state, marineData: action.value };
    case "SET_WIND_DATA":   return { ...state, windData: action.value };
    case "SET_ACTIVE_SOURCES": return { ...state, activeSources: action.value };
    case "UPDATE_SHIP":
      return { ...state, ship: { ...state.ship, [action.key]: action.value } };
    case "APPLY_PRESET":
      return { ...state, preset: action.key, ship: { ...PRESETS[action.key] } };
    case "SET_LAT":
      return { ...state, latDeg: action.deg ?? state.latDeg,
        latMin: action.min ?? state.latMin, latHemi: action.hemi ?? state.latHemi };
    case "SET_LON":
      return { ...state, lonDeg: action.deg ?? state.lonDeg,
        lonMin: action.min ?? state.lonMin, lonHemi: action.hemi ?? state.lonHemi };
    case "APPLY_LOCATION": {
      const nLat = decimalToNautical(action.lat, true);
      const nLon = decimalToNautical(action.lon, false);
      return { ...state, locationKey: action.key,
        latDeg: nLat.deg, latMin: nLat.min, latHemi: nLat.hemi,
        lonDeg: nLon.deg, lonMin: nLon.min, lonHemi: nLon.hemi };
    }
    case "FETCH_START":
      return { ...state, loading: true, error: null };
    case "FETCH_DONE":
      return { ...state, loading: false,
        marineData: action.marine ?? state.marineData,
        windData: action.wind ?? state.windData,
        lastFetch: new Date(), hourIdx: 0 };
    case "FETCH_ERROR":
      return { ...state, loading: false, error: action.message };
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────
const AppStateContext = createContext(null);
const AppDispatchContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, null, makeInitialState);

  // Persist to localStorage on every state change (debounce-free — state changes are infrequent)
  useEffect(() => { persistState(state); }, [
    state.preset, state.ship, state.speed, state.heading,
    state.locationKey, state.latDeg, state.latMin, state.latHemi,
    state.lonDeg, state.lonMin, state.lonHemi, state.activeSources, state.activeTab,
  ]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

// ─── Consumer hooks ─────────────────────────────────────────────────────────
export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within <AppProvider>");
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within <AppProvider>");
  return ctx;
}

// ─── Convenience setters (wraps dispatch for cleaner call sites) ────────────
export function useAppActions() {
  const dispatch = useAppDispatch();
  return {
    setTab:       (v) => dispatch({ type: "SET_TAB", value: v }),
    setSpeed:     (v) => dispatch({ type: "SET_SPEED", value: v }),
    setHeading:   (v) => dispatch({ type: "SET_HEADING", value: v }),
    setHourIdx:   (v) => dispatch({ type: "SET_HOUR_IDX", value: v }),
    setError:     (v) => dispatch({ type: "SET_ERROR", value: v }),
    setActiveSources: (v) => dispatch({ type: "SET_ACTIVE_SOURCES", value: v }),
    updateShip:   (k, v) => dispatch({ type: "UPDATE_SHIP", key: k, value: v }),
    applyPreset:  (k) => dispatch({ type: "APPLY_PRESET", key: k }),
    setLat:       (o) => dispatch({ type: "SET_LAT", ...o }),
    setLon:       (o) => dispatch({ type: "SET_LON", ...o }),
    applyLocation:(k, lat, lon) => dispatch({ type: "APPLY_LOCATION", key: k, lat, lon }),
    fetchStart:   () => dispatch({ type: "FETCH_START" }),
    fetchDone:    (marine, wind) => dispatch({ type: "FETCH_DONE", marine, wind }),
    fetchError:   (msg) => dispatch({ type: "FETCH_ERROR", message: msg }),
  };
}
