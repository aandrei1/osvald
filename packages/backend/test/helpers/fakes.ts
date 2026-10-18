import type { Redis } from 'ioredis';
import { vi, type Mock } from 'vitest';

import type { QueueRegistry } from '../../src/queue/queues.js';

/**
 * Stand-ins for the two pieces of infrastructure the API only *uses* rather than
 * reasons about. Route tests care that a job was enqueued and that `/health`
 * reports a dependency, not that Redis/BullMQ are running.
 */

export interface FakeQueues {
  registry: QueueRegistry;
  /** `app.queues.scriptParsing.add` */
  add: Mock;
  /** `app.queues.scriptParsing.remove` */
  remove: Mock;
}

/** BullMQ queue registry that records calls instead of talking to Redis. */
export function createFakeQueues(): FakeQueues {
  const add = vi.fn(async (_name: string, _data: unknown, options?: { jobId?: string }) => ({
    id: options?.jobId ?? 'test-job',
  }));
  const remove = vi.fn(async () => 1);
  const close = vi.fn(async () => undefined);

  const registry = {
    scriptParsing: { add, remove, close },
    close,
  } as unknown as QueueRegistry;

  return { registry, add, remove };
}

export interface FakeRedisOptions {
  /** Override the reply to `PING`; reject to simulate an outage. */
  ping?: () => Promise<string>;
  /** ioredis reports `'ready'` once connected; `'wait'` makes the probe connect. */
  status?: string;
}

/** Minimal ioredis surface used by `buildApp()` and the health probe. */
export function createFakeRedis(options: FakeRedisOptions = {}): Redis {
  const fake = {
    status: options.status ?? 'ready',
    on: vi.fn().mockReturnThis(),
    ping: options.ping ?? vi.fn(async () => 'PONG'),
    connect: vi.fn(async () => undefined),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
  };

  return fake as unknown as Redis;
}
