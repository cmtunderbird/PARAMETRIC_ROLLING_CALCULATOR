import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    proxy: {
      // ── CMEMS proxy → local Node.js cmems-server.js (port 5174) ─────────
      // Browser calls /cmems-proxy/... → forwarded to the Node server which
      // calls the new copernicusmarine Python toolbox (v2.x).
      // The old nrt.cmems-du.eu THREDDS endpoint was decommissioned April 2024.
      '/api/cmems': {
        target: 'http://localhost:5174',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
