import { sql } from 'drizzle-orm';
import type { HealthDependency, HealthResponse } from '@osvald/shared';
import type { Redis } from 'ioredis';

import { env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { timeIt, withTimeout } from '../lib/async.js';

/** Probes must never hold the request open; each one gets this budget. */
const PROBE_TIMEOUT_MS = 1_500;

export interface HealthProbes {
  db: Database;
  redis: Redis;
}

async function probe(
  name: HealthDependency['name'],
  check: () => Promise<void>,
): Promise<HealthDependency> {
  try {
    const { durationMs } = await timeIt(() => withTimeout(check(), PROBE_TIMEOUT_MS, name));
    return { name, status: 'up', latencyMs: durationMs, message: null };
  } catch (error) {
    return {
      name,
      status: 'down',
      latencyMs: null,
      message: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

/**
 * Verifies that every backing service answers.
 *
 * The request always resolves (a dead dependency is reported as `down`), so the
 * frontend can show a useful status card instead of a failed request.
 */
export async function collectHealth({ db, redis }: HealthProbes): Promise<HealthResponse> {
  const dependencies: HealthDependency[] = await Promise.all([
    probe('database', async () => {
      await db.execute(sql`select 1`);
    }),
    probe('redis', async () => {
      // The client is created with `lazyConnect`, so the first command would be
      // rejected with "Stream isn't writeable" before the socket exists.
      if (redis.status === 'wait') {
        await redis.connect();
      }

      const reply = await redis.ping();
      if (reply !== 'PONG') {
        throw new Error(`unexpected reply from PING: ${reply}`);
      }
    }),
    probe('ocrService', async () => {
      const response = await fetch(`${env.OCR_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    }),
  ]);

  return {
    status: dependencies.every((dependency) => dependency.status === 'up') ? 'ok' : 'degraded',
    service: 'osvald-backend',
    version: env.APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies,
  } satisfies HealthResponse;
}
