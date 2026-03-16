// electron/main.js — Electron main process
// Parametric Rolling Calculator — Desktop Edition
//
// Responsibilities:
//   1. Create the BrowserWindow and load the Vite-built React app
//   2. Spawn cmems-server.js as a child process (manages its lifetime)
//   3. Expose OS-level credential storage via safeStorage (Windows Credential Manager)
//   4. Handle app lifecycle (single instance lock, clean exit)

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { safeStorage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const isDev     = process.env.NODE_ENV === 'development';
const isPacked  = app.isPackaged;

// Windows taskbar grouping
app.setAppUserModelId('com.maritime.parametric-rolling-calculator');

// ── Single-instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── CMEMS server child process ─────────────────────────────────────────────
// In dev: runs from project root using local node
// In packaged app: uses the bundled node_modules
let cmemsServer = null;

function startCmemsServer() {
  // Resolve paths that work both in dev and packaged
  const serverPath = isPacked
    ? path.join(process.resourcesPath, 'cmems-server.js')
    : path.join(ROOT, 'cmems-server.js');

  if (!fs.existsSync(serverPath)) {
    console.warn('[cmems] cmems-server.js not found at', serverPath);
    return;
  }

  // Use the same node binary Electron ships with for the child process
  const nodeBin = process.execPath;

  cmemsServer = spawn(nodeBin, [serverPath], {
    cwd: isPacked ? process.resourcesPath : ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_PATH: isPacked
        ? path.join(process.resourcesPath, 'node_modules')
        : path.join(ROOT, 'node_modules'),
      // Tell cmems-server.js where to find cmems_worker.py when packaged
      CMEMS_WORKER_PATH: isPacked
        ? path.join(process.resourcesPath, 'cmems_worker.py')
        : path.join(ROOT, 'cmems_worker.py'),
    },
  });

  cmemsServer.stdout.on('data', d => {
    const t = d.toString().trim();
    if (t) console.log('[cmems]', t);
  });
  cmemsServer.stderr.on('data', d => {
    const t = d.toString();
    if (!t.includes('DeprecationWarning') && !t.includes('ExperimentalWarning'))
      console.error('[cmems]', t.trim());
  });
  cmemsServer.on('exit', (code, signal) => {
    console.log(`[cmems] server exited (code=${code} signal=${signal})`);
    cmemsServer = null;
  });
}

function stopCmemsServer() {
  if (cmemsServer) {
    cmemsServer.kill('SIGTERM');
    cmemsServer = null;
  }
}

// ── Credential store via safeStorage (OS keychain) ─────────────────────────
// Windows: DPAPI via Windows Credential Manager (encrypted to current user)
// Falls back to plain JSON in userData if encryption unavailable
const CRED_PATH       = path.join(app.getPath('userData'), 'cmems-creds.enc');
const CRED_PATH_PLAIN = path.join(app.getPath('userData'), 'cmems-creds.json');

function credsSave(user, pass) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(JSON.stringify({ user, pass }));
      fs.writeFileSync(CRED_PATH, enc);
      // Remove plain fallback if it existed
      if (fs.existsSync(CRED_PATH_PLAIN)) fs.unlinkSync(CRED_PATH_PLAIN);
    } else {
      fs.writeFileSync(CRED_PATH_PLAIN, JSON.stringify({ user, pass }), 'utf8');
    }
    return { ok: true };
  } catch(e) {
    console.error('credsSave failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function credsLoad() {
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(CRED_PATH)) {
      const enc = fs.readFileSync(CRED_PATH);
      return JSON.parse(safeStorage.decryptString(enc));
    }
    if (fs.existsSync(CRED_PATH_PLAIN)) {
      return JSON.parse(fs.readFileSync(CRED_PATH_PLAIN, 'utf8'));
    }
  } catch(e) { console.error('credsLoad failed:', e.message); }
  return { user: '', pass: '' };
}

function credsClear() {
  try {
    if (fs.existsSync(CRED_PATH))       fs.unlinkSync(CRED_PATH);
    if (fs.existsSync(CRED_PATH_PLAIN)) fs.unlinkSync(CRED_PATH_PLAIN);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
}

// ── IPC handlers (renderer ↔ main via contextBridge) ───────────────────────
ipcMain.handle('creds:save',         (_, { user, pass }) => credsSave(user, pass));
ipcMain.handle('creds:load',         ()                  => credsLoad());
ipcMain.handle('creds:clear',        ()                  => credsClear());
ipcMain.handle('app:version',        ()                  => app.getVersion());
ipcMain.handle('shell:openExternal', (_, url)            => shell.openExternal(url));

// ── BrowserWindow ──────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  const iconPath = isPacked
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(ROOT, 'public', 'icon.png');

  mainWindow = new BrowserWindow({
    width:  1440,
    height: 920,
    minWidth:  1100,
    minHeight: 700,
    title: 'Parametric Rolling Calculator',
    backgroundColor: '#0F172A',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,    // renderer cannot access Node directly
      nodeIntegration:  false,   // no require() in renderer
      sandbox:          false,   // preload needs ipcRenderer
    },
  });

  // Remove default menu bar (professional app appearance)
  mainWindow.setMenuBarVisibility(false);

  if (isDev && !isPacked) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }

  // Open external links in default browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startCmemsServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  stopCmemsServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopCmemsServer());
