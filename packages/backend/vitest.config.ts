import { defineConfig } from 'vitest/config';

/**
 * Backend tests.
 *
 * Two groups live here:
 *
 *  - unit tests (`src/**\/*.test.ts`) for the pure parsing/config helpers;
 *  - integration tests (`test/**\/*.test.ts`) that build the real Fastify app
 *    with `buildApp()` and drive it through `app.inject()`.
 *
 * `setup.ts` seeds the environment before any module imports `config/env.ts`
 * (which validates at import time and exits the process on a bad value).
 *
 * Integration files share one Postgres database and truncate it between tests,
 * so they must not run in parallel — `fileParallelism: false` keeps the suite
 * deterministic while the unit files stay cheap enough to run in the same pass.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/scripts/**'],
    },
  },
});
