/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      // Only the pure layers carry a coverage bar. UI tests are deliberately lighter,
      // so including src/ui here would let thin component tests mask solver gaps.
      include: ['src/domain/**', 'src/solver/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
