import { healthResponseSchema } from '@osvald/shared';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/client.js';
import { createTestApp } from '../helpers/app.js';
import { tryCreateTestDatabase } from '../helpers/database.js';
import { createFakeRedis } from '../helpers/fakes.js';

/**
 * `/health` is what the app, Docker and this suite use to see whether the
 * backing services are reachable. The contract is that it always answers 200
 * and reports each dependency, even when they are down.
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

describe.skipIf(database === null)('GET /health', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports every dependency when they answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    const test = await createTestApp(db());
    try {
      const response = await test.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);

      const body = healthResponseSchema.parse(response.json());
      expect(body.status).toBe('ok');
      expect(
        body.dependencies.map((dependency) => `${dependency.name}:${dependency.status}`),
      ).toEqual(['database:up', 'redis:up', 'ocrService:up', 'ttsService:up']);
    } finally {
      await test.close();
    }
  });

  it('degrades when Redis is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    const test = await createTestApp(db(), {
      redis: createFakeRedis({
        ping: async () => {
          throw new Error('connection refused');
        },
      }),
    });

    try {
      const response = await test.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);

      const body = healthResponseSchema.parse(response.json());
      expect(body.status).toBe('degraded');
      expect(body.dependencies.find((dependency) => dependency.name === 'redis')).toMatchObject({
        status: 'down',
        latencyMs: null,
      });
    } finally {
      await test.close();
    }
  });

  it('degrades when the Python services answer with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    const test = await createTestApp(db());
    try {
      const response = await test.app.inject({ method: 'GET', url: '/health' });
      const body = healthResponseSchema.parse(response.json());

      expect(body.status).toBe('degraded');
      expect(
        body.dependencies
          .filter((dependency) => dependency.status === 'down')
          .map((dependency) => dependency.name),
      ).toEqual(['ocrService', 'ttsService']);
    } finally {
      await test.close();
    }
  });
});
