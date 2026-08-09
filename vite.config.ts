import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// The Chrome extension itself is assembled by build-extension.js.
// Vite only builds the small static landing / install page in index.html.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
