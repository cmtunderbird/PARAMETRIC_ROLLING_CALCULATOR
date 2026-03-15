import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      // ── CMEMS OPeNDAP CORS proxy ──────────────────────────────────────────
      // Browser calls /cmems-proxy/...  →  Vite forwards to nrt.cmems-du.eu
      // Authorization header is relayed transparently.
      // This eliminates the CORS block entirely — no extra dependencies needed.
      '/cmems-proxy': {
        target: 'https://nrt.cmems-du.eu',
        changeOrigin: true,
        secure: true,
        rewrite: path => path.replace(/^\/cmems-proxy/, '/thredds/dodsC'),
        headers: {
          // Identify as a legitimate scientific data client
          'User-Agent': 'ParametricRollingCalculator/0.6 (OPeNDAP client)',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
