// electron/preload.js — Context bridge (renderer ↔ main IPC)
// Only exposes the specific APIs the React app needs.
// The renderer has NO access to Node.js or Electron internals.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Credentials (OS keychain via safeStorage) ─────────────────────────
  credsSave:  (user, pass) => ipcRenderer.invoke('creds:save', { user, pass }),
  credsLoad:  ()           => ipcRenderer.invoke('creds:load'),
  credsClear: ()           => ipcRenderer.invoke('creds:clear'),

  // ── App ───────────────────────────────────────────────────────────────
  getVersion:   ()    => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── CMEMS — dedicated named calls, no generic HTTP proxy ─────────────
  // Main process waits for server ready, builds the request, returns JSON.
  // Renderer never calls fetch() or constructs URLs/headers itself.
  cmems: {
    test:    (user, pass)                              => ipcRenderer.invoke('cmems:test',    { user, pass }),
    wave:    (user, pass, south, north, west, east, forecastDays) => ipcRenderer.invoke('cmems:wave',    { user, pass, south, north, west, east, forecastDays }),
    physics: (user, pass, south, north, west, east)   => ipcRenderer.invoke('cmems:physics', { user, pass, south, north, west, east }),
    alive:   ()                                        => ipcRenderer.invoke('cmems:alive'),
  },

  // ── Runtime detection ─────────────────────────────────────────────────
  isElectron: true,
});
