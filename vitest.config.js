import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.js so the production build never has to
// resolve anything from vitest. Vercel builds must not depend on dev tooling.
export default defineConfig({
  resolve: {
    alias: { '@': '/src' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    // Tests must never reach a real backend. Firebase is mocked per-file; this
    // is a second line of defence against an accidental live call.
    env: {
      VITE_FIREBASE_API_KEY: 'test-key-not-real',
      VITE_FIREBASE_PROJECT_ID: 'test-project-not-real',
    },
  },
})
