// electron/preload.js — Context bridge (renderer ↔ main IPC)
// Only exposes the specific APIs the React app needs.
// The renderer has NO access to Node.js or Electron internals.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── CMEMS credentials (OS keychain via safeStorage) ──────────────────────
  credsSave:  (user, pass) => ipcRenderer.invoke('creds:save', { user, pass }),
  credsLoad:  ()           => ipcRenderer.invoke('creds:load'),
  credsClear: ()           => ipcRenderer.invoke('creds:clear'),

  // ── App info ──────────────────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:version'),

  // ── Open URLs in default browser (not in Electron window) ─────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── CMEMS server health check (via main process — bypasses file:// security) ─
  checkServerAlive: () => ipcRenderer.invoke('cmems:alive'),

  // ── Generic CMEMS HTTP proxy (all fetch to localhost routes via main process) ─
  cmemsRequest: (opts) => ipcRenderer.invoke('cmems:fetch', opts),

  // ── Runtime detection ─────────────────────────────────────────────────────
  isElectron: true,
});
