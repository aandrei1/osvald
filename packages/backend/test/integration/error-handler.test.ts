import { apiErrorSchema } from '@osvald/shared';
import { afterAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/db/client.js';
import { createTestApp } from '../helpers/app.js';
import { tryCreateTestDatabase } from '../helpers/database.js';

/**
 * Every non-2xx response must match the shared `ApiError` shape: the frontend
 * renders `message` and reads `statusCode`, so a handler that leaks a raw
 * Fastify error would break error reporting in the app.
 */

const database = await tryCreateTestDatabase();

afterAll(async () => {
  await database?.close();
});

function db(): Database {
  if (database === null) {
    throw new Error('test database unavailable');
  }
  return database.db;
}

describe.skipIf(database === null)('error handling', () => {
  it('answers an unknown route with the shared ApiError shape', async () => {
    const test = await createTestApp(db());

    try {
      const response = await test.app.inject({ method: 'GET', url: '/does-not-exist' });

      expect(response.statusCode).toBe(404);

      const body = apiErrorSchema.parse(response.json());
      expect(body.error).toBe('Not Found');
      expect(body.message).toContain('GET /does-not-exist');
    } finally {
      await test.close();
    }
  });

  it('turns a Zod request validation failure into 400 with field details', async () => {
    const test = await createTestApp(db());

    try {
      // Validation runs before the auth preHandler, so no token is needed.
      const response = await test.app.inject({ method: 'GET', url: '/scripts/not-a-uuid' });

      expect(response.statusCode).toBe(400);

      const body = apiErrorSchema.parse(response.json());
      expect(body.message).toBe('Request validation failed');
      expect(body.details?.length).toBeGreaterThan(0);
    } finally {
      await test.close();
    }
  });
});
