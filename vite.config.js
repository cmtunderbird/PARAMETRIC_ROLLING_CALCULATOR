import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    proxy: {
      // ── CMEMS proxy → local Node.js cmems-server.js (port 5174) ─────────
      // NOTE: This proxy is ONLY active during `npm run dev`.
      // The built dist/ files have NO proxy — cmems-server.js must be
      // reached via a reverse proxy (nginx/caddy) in any production setup.
      // For local use, always launch via launch.bat or `npm run dev`.
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
