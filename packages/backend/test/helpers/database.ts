import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { Database } from '../../src/db/client.js';
import * as schema from '../../src/db/schema/index.js';

/**
 * Disposable Postgres database for integration tests.
 *
 * The committed Drizzle migrations are applied to a database of their own
 * (`osvald_test` by default), so the suite exercises the real schema and the
 * real queries while leaving the development database untouched.
 */

const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const DEFAULT_TEST_DATABASE_URL = 'postgres://osvald:osvald@localhost:5433/osvald_test';

export interface TestDatabase {
  db: Database;
  /** Empties every table, so each test starts from a known state. */
  truncate(): Promise<void>;
  close(): Promise<void>;
}

function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Connects to the server's maintenance database and creates the test database
 * when it does not exist yet. `CREATE DATABASE` cannot run inside a transaction
 * and cannot take a bind parameter, hence the quoted identifier.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (databaseName.length === 0) {
    throw new Error(`TEST_DATABASE_URL has no database name: ${url}`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });

  try {
    const rows = await admin<{ exists: boolean }[]>`
      select exists(select 1 from pg_database where datname = ${databaseName}) as exists
    `;

    if (rows[0]?.exists !== true) {
      await admin.unsafe(`create database ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/**
 * Creates the test database and applies the migrations.
 *
 * Returns `null` when the server cannot be reached, so a checkout without
 * Docker still gets the unit suite instead of a hard failure. Migration errors
 * are allowed to propagate: they are a real problem, not a missing service.
 */
export async function tryCreateTestDatabase(url = testDatabaseUrl()): Promise<TestDatabase | null> {
  let client: ReturnType<typeof postgres>;

  try {
    await ensureDatabaseExists(url);
    client = postgres(url, { max: 4, onnotice: () => undefined });
    await client`select 1`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[integration] Postgres is not reachable at ${url}; skipping. (${message})`);
    return null;
  }

  const db = drizzle(client, { schema, casing: 'snake_case' });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    async truncate(): Promise<void> {
      await client.unsafe(
        'truncate table lines, scenes, characters, scripts, users restart identity cascade',
      );
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}
