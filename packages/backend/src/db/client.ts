import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env.js';
import * as schema from './schema/index.js';

/**
 * Postgres (postgres.js) + Drizzle client.
 *
 * postgres.js connects lazily, so importing this module never blocks on the
 * database being up. `close()` must run on shutdown (wired up in `buildApp`).
 */

export function createDatabase(databaseUrl: string = env.DATABASE_URL) {
  const client = postgres(databaseUrl, {
    max: env.DATABASE_POOL_MAX,
    // Postgres NOTICE messages (e.g. from migrations) are noise at boot.
    onnotice: () => undefined,
  });

  const db = drizzle(client, {
    schema,
    casing: 'snake_case',
    logger: env.LOG_LEVEL === 'debug',
  });

  return {
    client,
    db,
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

/** The Drizzle instance type, used to decorate Fastify and type the services. */
export type Database = ReturnType<typeof createDatabase>['db'];
