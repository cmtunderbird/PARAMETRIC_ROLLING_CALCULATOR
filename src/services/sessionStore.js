// ─── sessionStore.js — IndexedDB persistence for watch handover ──────────────
// Phase 1, Item 10
// Stores full assessment state (route, weather, risk) too large for localStorage.
// On app launch, offers to resume previous assessment or start fresh.

const DB_NAME = "prc_sessions";
const DB_VERSION = 1;
const STORE_NAME = "assessments";
const CURRENT_KEY = "current_session";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function idbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result ?? null);
    });
  } catch { return null; }
}

async function idbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(true);
    });
  } catch { return false; }
}

async function idbDelete(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(true);
    });
  } catch { return false; }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Save current assessment to IndexedDB */
export async function saveSession(sessionData) {
  const payload = {
    ...sessionData,
    savedAt: new Date().toISOString(),
    version: 1,
  };
  return idbSet(CURRENT_KEY, payload);
}

/** Load previous session (returns null if none) */
export async function loadSession() {
  return idbGet(CURRENT_KEY);
}

/** Clear saved session (user chose "Start Fresh") */
export async function clearSession() {
  return idbDelete(CURRENT_KEY);
}

/** Check if a previous session exists (non-blocking) */
export async function hasSession() {
  const session = await idbGet(CURRENT_KEY);
  return session !== null;
}
