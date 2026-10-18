import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the shared contract (Zod schemas + pure helpers).
 *
 * The package is plain ESM TypeScript with no DOM, so the default Node
 * environment is enough and nothing needs to be mocked.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
