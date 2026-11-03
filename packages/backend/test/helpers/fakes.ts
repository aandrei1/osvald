import type { Redis } from 'ioredis';
import { vi, type Mock } from 'vitest';

import type { Clock } from '../../src/ports/clock.js';
import type {
  EnqueueOutcome,
  ExtractionJob,
  ExtractionQueue,
  RunRef,
} from '../../src/ports/extraction-queue.js';
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
  const getJob = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);

  const registry = {
    scriptParsing: { add, remove, getJob, close },
    close,
  } as unknown as QueueRegistry;

  return { registry, add, remove };
}

/**
 * In-memory `ExtractionQueue`. Like the BullMQ adapter it is idempotent per run:
 * a run that already has a job is not queued twice.
 */
export interface FakeExtractionQueue extends ExtractionQueue {
  /** Every job ever accepted, in order. */
  jobs: ExtractionJob[];
  enqueue: Mock<(job: ExtractionJob) => Promise<EnqueueOutcome>>;
  /** Marks a run's job as failed for good, as BullMQ would after a stall. */
  failRun(run: RunRef, reason: string): void;
  /** Forgets every job, as if Redis had been flushed. */
  lose(): void;
}

export function createFakeExtractionQueue(): FakeExtractionQueue {
  const jobs: ExtractionJob[] = [];
  const queued = new Set<string>();
  const failures = new Map<string, string>();
  const key = (run: RunRef): string => `${run.scriptId}_${run.runId}`;

  const enqueue = vi.fn(async (job: ExtractionJob): Promise<EnqueueOutcome> => {
    if (queued.has(key(job))) {
      return 'already_queued';
    }
    queued.add(key(job));
    jobs.push(job);
    return 'added';
  });

  return {
    jobs,
    enqueue,
    async failureOf(run: RunRef): Promise<string | null> {
      return failures.get(key(run)) ?? null;
    },
    failRun(run: RunRef, reason: string): void {
      failures.set(key(run), reason);
    },
    lose(): void {
      queued.clear();
    },
  };
}

/** A clock that only moves when told to. */
export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export function createFakeClock(start = new Date('2026-11-03T10:00:00.000Z')): FakeClock {
  let current = start.getTime();

  return {
    now: () => new Date(current),
    advance(ms: number): void {
      current += ms;
    },
  };
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
