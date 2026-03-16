// electron/main.js — Electron main process
// Parametric Rolling Calculator — Desktop Edition
//
// Responsibilities:
//   1. Create the BrowserWindow and load the Vite-built React app
//   2. Spawn cmems-server.js as a child process (manages its lifetime)
//   3. Expose OS-level credential storage via safeStorage (Windows Credential Manager)
//   4. Handle app lifecycle (single instance lock, tray, clean exit)

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { safeStorage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const isDev     = process.env.NODE_ENV === 'development';

// ── Single-instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── CMEMS server child process ─────────────────────────────────────────────
let cmemsServer = null;

function startCmemsServer() {
  const serverPath = path.join(ROOT, 'cmems-server.js');
  if (!fs.existsSync(serverPath)) {
    console.warn('cmems-server.js not found — CMEMS features unavailable');
    return;
  }
  cmemsServer = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  cmemsServer.stdout.on('data', d => console.log('[cmems]', d.toString().trim()));
  cmemsServer.stderr.on('data', d => {
    const t = d.toString();
    if (!t.includes('DeprecationWarning')) console.error('[cmems]', t.trim());
  });
  cmemsServer.on('exit', (code, signal) => {
    console.log(`[cmems] server exited (code=${code} signal=${signal})`);
    cmemsServer = null;
  });
}

function stopCmemsServer() {
  if (cmemsServer) { cmemsServer.kill('SIGTERM'); cmemsServer = null; }
}

// ── Credential store via safeStorage (OS keychain) ─────────────────────────
// Keys are stored encrypted in the OS credential store.
// On Windows: DPAPI via Windows Credential Manager
// Falls back to plain JSON if safeStorage is unavailable (CI / headless)
const CRED_PATH = path.join(app.getPath('userData'), 'cmems-credentials.enc');

function credsSave(user, pass) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const payload = JSON.stringify({ user, pass });
      const enc = safeStorage.encryptString(payload);
      fs.writeFileSync(CRED_PATH, enc);
    } else {
      // Fallback: store in userData as JSON (no encryption available in this env)
      fs.writeFileSync(CRED_PATH + '.plain', JSON.stringify({ user, pass }), 'utf8');
    }
    return true;
  } catch(e) { console.error('credsSave failed:', e.message); return false; }
}

function credsLoad() {
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(CRED_PATH)) {
      const enc = fs.readFileSync(CRED_PATH);
      const payload = safeStorage.decryptString(enc);
      return JSON.parse(payload);
    }
    const plain = CRED_PATH + '.plain';
    if (fs.existsSync(plain)) return JSON.parse(fs.readFileSync(plain, 'utf8'));
  } catch(e) { console.error('credsLoad failed:', e.message); }
  return { user: '', pass: '' };
}

function credsClear() {
  try {
    if (fs.existsSync(CRED_PATH))         fs.unlinkSync(CRED_PATH);
    if (fs.existsSync(CRED_PATH+'.plain')) fs.unlinkSync(CRED_PATH+'.plain');
    return true;
  } catch(e) { return false; }
}

// ── IPC handlers (renderer ↔ main) ─────────────────────────────────────────
ipcMain.handle('creds:save',  (_, { user, pass }) => credsSave(user, pass));
ipcMain.handle('creds:load',  ()                  => credsLoad());
ipcMain.handle('creds:clear', ()                  => credsClear());
ipcMain.handle('app:version', ()                  => app.getVersion());
ipcMain.handle('shell:openExternal', (_, url)     => shell.openExternal(url));

// ── BrowserWindow ──────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  1100,
    minHeight: 700,
    title: 'Parametric Rolling Calculator',
    backgroundColor: '#0F172A',
    icon: path.join(ROOT, 'public', 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // security: renderer cannot access Node APIs directly
      nodeIntegration:  false,  // security: no require() in renderer
      sandbox:          false,  // needed for preload to use ipcRenderer
    },
  });

  if (isDev) {
    // Dev mode: load Vite dev server (port 3000)
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: load built dist/index.html
    mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }

  // Open external links in the default browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startCmemsServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  // Focus the existing window if user tries to open a second instance
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  stopCmemsServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopCmemsServer(); });
