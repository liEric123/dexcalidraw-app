import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // Loaded via dynamic import on first Mermaid insert; without
    // pre-bundling, dev-mode discovery would force a full page reload
    // mid-session.
    include: ['@excalidraw/mermaid-to-excalidraw'],
  },
  server: {
    // Browser storage is keyed by origin, so the dev URL must never drift:
    // silently falling back to another port would split the user's decks
    // across two invisible storage universes. Fail loudly instead.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        // The Excalidraw ESM build uses extensionless internal imports that
        // Node's resolver rejects; route it through Vite's transform instead.
        inline: [/@excalidraw\/excalidraw/],
      },
    },
  },
})
