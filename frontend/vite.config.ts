import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser only ever talks to our backend; all third-party API calls (and keys) stay server-side.
const backendUrl = process.env.VITE_BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: backendUrl, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
})
