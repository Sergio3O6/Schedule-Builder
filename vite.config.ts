// defineConfig comes from vitest/config, not vite: only vitest's overload accepts
// the `test` key. A triple-slash reference does not widen vite's own signature.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // The default 5s is enough for an ordinary run and not for an instrumented
    // one. bundle.test.ts hashes the whole EECS export twice to prove the bytes
    // are deterministic, and under v8 coverage that reliably runs past five
    // seconds — which is why enabling the coverage gate needs this and not a
    // change to the test. A slow test is not a failing one.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Only the pure layers carry a coverage bar. UI tests are deliberately lighter,
      // so including src/ui here would let thin component tests mask solver gaps.
      include: ['src/domain/**', 'src/solver/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
