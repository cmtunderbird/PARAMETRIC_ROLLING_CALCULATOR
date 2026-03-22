// ─── appStore.js — Centralised state with localStorage persistence ───────────
// Phase 1, Item 3
// React Context + useReducer replaces 30+ scattered useState calls in App.jsx.
// Persists vessel config, position, speed/heading, and preferences to localStorage
// so the incoming OOW sees the previous assessment on app launch.
import { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { decimalToNautical } from "../ui/components/NauticalCoord.jsx";

// ─── Vessel Presets ──────────────────────────────────────────────────────────
export const PRESETS = {
  container_large: { name: "Large Container (14,000 TEU)", Lwl: 350, B: 48.2, d: 14.5, GM: 1.8, Cb: 0.65, rollDamping: 0.05 },
  container_med:   { name: "Medium Container (4,000 TEU)", Lwl: 260, B: 32.2, d: 12.0, GM: 1.5, Cb: 0.62, rollDamping: 0.05 },
  container_small: { name: "Small Container (1,000 TEU)",  Lwl: 150, B: 25.0, d: 8.5,  GM: 1.2, Cb: 0.60, rollDamping: 0.06 },
  pcc:             { name: "Pure Car Carrier",              Lwl: 199, B: 32.3, d: 9.2,  GM: 2.0, Cb: 0.58, rollDamping: 0.05 },
  tanker:          { name: "VLCC Tanker (laden, w/ BK)",    Lwl: 320, B: 58,   d: 20.5, GM: 5.5, Cb: 0.82, rollDamping: 0.10 },
  bulk:            { name: "Capesize Bulker (w/ BK)",       Lwl: 280, B: 45,   d: 17.0, GM: 3.2, Cb: 0.85, rollDamping: 0.08 },
  roro:            { name: "Ro-Ro Ferry",                   Lwl: 186, B: 28.6, d: 6.8,  GM: 1.9, Cb: 0.55, rollDamping: 0.07 },
  custom:          { name: "Custom Vessel",                  Lwl: 200, B: 32,   d: 10,   GM: 1.5, Cb: 0.65, rollDamping: 0.05 },
};

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
