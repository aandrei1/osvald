import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — used by `pnpm db:generate|migrate|push|studio`.
 * `tsconfig.json` deliberately excludes this file from `tsc` (it is loaded by
 * drizzle-kit itself with its own TS loader).
 */

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run drizzle-kit (copy .env.example to .env)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
