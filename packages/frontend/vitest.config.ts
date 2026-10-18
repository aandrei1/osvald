import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Frontend tests.
 *
 * `happy-dom` gives the stores and the speech helpers the browser globals they
 * expect (`window`, `localStorage`, `Audio`) without starting a real browser.
 * Component rendering is not covered here; these tests target the Pinia stores
 * and the pure helpers that hold the rehearsal logic.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts', 'src/stores/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
