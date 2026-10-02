import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser only ever talks to our backend; all third-party API calls (and keys) stay server-side.
const backendUrl = process.env.VITE_BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tailwind runs as a Vite plugin. An inline (empty) PostCSS config stops Vite from picking up
  // a postcss.config.* from a parent directory outside the repo.
  css: { postcss: {} },
  server: {
    proxy: {
      '/api': { target: backendUrl, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
})
