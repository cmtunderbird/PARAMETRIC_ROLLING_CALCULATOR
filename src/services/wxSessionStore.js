// ─── wxSessionStore.js — IndexedDB persistence for weather state ─────────────
// localStorage is limited to ~5MB — weather grids easily exceed this.
// IndexedDB has no practical limit in Electron (~50MB+).
const DB_NAME = "prc_wx_sessions";
const DB_VERSION = 2;  // bumped to flush stale corrupted data from v1
const STORE = "wx_state";
const KEY = "current";
const MAX_AGE_MS = 6 * 3600000; // 6 hours

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Delete and recreate store on version bump to flush stale data
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
  });
}

export async function saveWxSession(data) {
  try {
    const db = await openDB();
    const payload = { ...data, savedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.put(payload, KEY);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(true);
    });
  } catch (e) {
    console.warn("[wxSessionStore] save failed:", e.message);
    return false;
  }
}

export async function loadWxSession() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.get(KEY);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const data = req.result;
        if (!data) return resolve(null);
        if (Date.now() - data.savedAt > MAX_AGE_MS) return resolve(null);
        resolve(data);
      };
    });
  } catch {
    return null;
  }
}
