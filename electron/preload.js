// electron/preload.js — Context bridge (renderer ↔ main IPC)
// ALL functions are top-level — nested objects can fail silently in contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Credentials ──────────────────────────────────────────────────────────
  credsSave:  (user, pass) => ipcRenderer.invoke('creds:save', { user, pass }),
  credsLoad:  ()           => ipcRenderer.invoke('creds:load'),
  credsClear: ()           => ipcRenderer.invoke('creds:clear'),

  // ── App ───────────────────────────────────────────────────────────────────
  getVersion:   ()    => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── CMEMS — flat top-level functions (nested objects break in contextBridge) ─
  cmemsTest:    (user, pass)                                                   => ipcRenderer.invoke('cmems:test',    { user, pass }),
  cmemsWave:    (user, pass, south, north, west, east, forecastDays)           => ipcRenderer.invoke('cmems:wave',    { user, pass, south, north, west, east, forecastDays }),
  cmemsPhysics: (user, pass, south, north, west, east)                         => ipcRenderer.invoke('cmems:physics', { user, pass, south, north, west, east }),
  cmemsAlive:   ()                                                             => ipcRenderer.invoke('cmems:alive'),

  // ── Runtime detection ─────────────────────────────────────────────────────
  isElectron: true,
});
