// electron/preload.js
// ALL functions top-level. No nested objects — they can fail silently in contextBridge.
// Console log at end confirms script ran to completion.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Credentials ──────────────────────────────────────────────────────────
  credsSave:    (user, pass) => ipcRenderer.invoke('creds:save',    { user, pass }),
  credsLoad:    ()           => ipcRenderer.invoke('creds:load'),
  credsClear:   ()           => ipcRenderer.invoke('creds:clear'),

  // ── App ───────────────────────────────────────────────────────────────────
  getVersion:   ()    => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── CMEMS ─────────────────────────────────────────────────────────────────
  cmemsTest:    (user, pass)                                         => ipcRenderer.invoke('cmems:test',    { user, pass }),
  cmemsWave:    (user, pass, south, north, west, east, forecastDays) => ipcRenderer.invoke('cmems:wave',    { user, pass, south, north, west, east, forecastDays }),
  cmemsPhysics: (user, pass, south, north, west, east)               => ipcRenderer.invoke('cmems:physics', { user, pass, south, north, west, east }),
  cmemsAlive:   ()                                                   => ipcRenderer.invoke('cmems:alive'),

  // ── Runtime flag ──────────────────────────────────────────────────────────
  isElectron: true,
});

// Confirm preload ran to completion — visible in DevTools console
console.log('[preload] electronAPI bridge ready — cmemsTest:', typeof ipcRenderer.invoke);
