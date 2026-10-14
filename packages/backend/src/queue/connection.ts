import type { ConnectionOptions } from 'bullmq';
import { Redis, type RedisOptions as IoRedisOptions } from 'ioredis';

import { env } from '../config/env.js';

/**
 * Redis helpers.
 *
 * BullMQ v6 dropped its direct ioredis dependency (ioredis is now an optional
 * peer dependency), so the app owns the client and its options.
 *
 * We hand *options* — not a shared client — to `Queue`/`Worker`: BullMQ opens
 * several dedicated connections internally, and a Worker's blocking connection
 * must never be reused by producers or health probes.
 */

/**
 * BullMQ's own Redis option shape (it differs from ioredis': BullMQ accepts a
 * `url`, ioredis takes the URL as the first constructor argument).
 */
type BullRedisOptions = Extract<ConnectionOptions, { url?: string }>;

export function redisConnectionOptions(
  overrides: Partial<BullRedisOptions> = {},
): ConnectionOptions {
  return {
    url: env.REDIS_URL,
    // Required by BullMQ: commands must not fail after N retries while blocked.
    maxRetriesPerRequest: null,
    ...overrides,
  };
}

/**
 * General purpose ioredis client (caching, pub/sub, health probes).
 * Connects lazily so importing this module never blocks on Redis being up.
 */
export function createRedisClient(overrides: IoRedisOptions = {}): Redis {
  return new Redis(env.REDIS_URL, { lazyConnect: true, ...overrides });
}
