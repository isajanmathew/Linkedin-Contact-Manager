import { defineConfig } from 'vite'

// The Chrome extension itself is assembled by build-extension.js.
// Vite only builds the small static landing / install page in index.html.
export default defineConfig({
  server: {
    port: 8080,
    host: true,
    hmr: { overlay: false },
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
})
