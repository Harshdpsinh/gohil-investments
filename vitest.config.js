import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Deliberately separate from vite.config.js so the production build never has to
// resolve anything from vitest. Vercel builds must not depend on dev tooling.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' },
  },
  test: {
    // Node by default — the pure-logic suites are the bulk and need nothing else.
    // Component tests opt into jsdom with a `// @vitest-environment jsdom`
    // docblock at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'e2e/helpers/**/*.test.js'],
    // Tests must never reach a real backend. Firebase is mocked per-file; this
    // is a second line of defence against an accidental live call.
    env: {
      VITE_FIREBASE_API_KEY: 'test-key-not-real',
      VITE_FIREBASE_PROJECT_ID: 'test-project-not-real',
    },
  },
})
