import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Live tests hit the real Ollama cloud API; opt in with `npm run test:live`.
    exclude: process.env.LIVE ? [] : ['tests/live/**'],
    restoreMocks: true,
    unstubEnvs: true,
  },
})
