/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies the API & WebSocket to FastAPI so the browser only talks to one origin.
// Broker credentials live in the backend only — never in the frontend bundle.
const backend = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], globals: true },
})
