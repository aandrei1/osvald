import { describe, expect, it, vi } from 'vitest';

import type { QueueRegistry } from '../queue/queues.js';
import { createBullmqExtractionQueue, extractionJobId } from './bullmq-extraction-queue.js';

/**
 * The adapter is what makes enqueueing idempotent per run, which the recovery
 * job relies on. BullMQ ignores an `add` whose id exists, so the adapter has to
 * tell "still being handled" apart from "finished and safe to queue again".
 */

const RUN = {
  scriptId: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6b',
  runId: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6c',
};

function fakeQueue(existing?: { state: string; failedReason?: string }) {
  const remove = vi.fn(async () => undefined);
  const job =
    existing === undefined
      ? undefined
      : {
          getState: vi.fn(async () => existing.state),
          failedReason: existing.failedReason ?? '',
          remove,
        };

  const queue = {
    getJob: vi.fn(async () => job),
    add: vi.fn(async () => ({ id: extractionJobId(RUN) })),
  };

  return {
    queue: queue as unknown as Pick<QueueRegistry['scriptParsing'], 'add' | 'getJob'>,
    add: queue.add,
    remove,
  };
}

describe('extractionJobId', () => {
  it('joins the ids without the colon BullMQ forbids', () => {
    expect(extractionJobId(RUN)).toBe(`${RUN.scriptId}_${RUN.runId}`);
    expect(extractionJobId(RUN)).not.toContain(':');
  });
});

describe('createBullmqExtractionQueue', () => {
  it('adds a job for a run the queue has never seen', async () => {
    const fake = fakeQueue();

    await expect(
      createBullmqExtractionQueue(fake.queue).enqueue({ ...RUN, filePath: '/a.pdf' }),
    ).resolves.toBe('added');
    expect(fake.add).toHaveBeenCalledWith(
      'parse-script',
      { ...RUN, filePath: '/a.pdf' },
      { jobId: extractionJobId(RUN) },
    );
  });

  it('leaves a waiting or running job alone', async () => {
    for (const state of ['waiting', 'active', 'delayed', 'failed']) {
      const fake = fakeQueue({ state });

      await expect(
        createBullmqExtractionQueue(fake.queue).enqueue({ ...RUN, filePath: '/a.pdf' }),
      ).resolves.toBe('already_queued');
      expect(fake.add).not.toHaveBeenCalled();
    }
  });

  it('replaces a completed job, which would otherwise swallow the add', async () => {
    const fake = fakeQueue({ state: 'completed' });

    await expect(
      createBullmqExtractionQueue(fake.queue).enqueue({ ...RUN, filePath: '/a.pdf' }),
    ).resolves.toBe('added');
    expect(fake.remove).toHaveBeenCalled();
    expect(fake.add).toHaveBeenCalled();
  });

  it('reports why a run failed for good', async () => {
    const failed = fakeQueue({ state: 'failed', failedReason: 'job stalled' });
    const waiting = fakeQueue({ state: 'waiting' });
    const missing = fakeQueue();

    await expect(createBullmqExtractionQueue(failed.queue).failureOf(RUN)).resolves.toBe(
      'job stalled',
    );
    await expect(createBullmqExtractionQueue(waiting.queue).failureOf(RUN)).resolves.toBeNull();
    await expect(createBullmqExtractionQueue(missing.queue).failureOf(RUN)).resolves.toBeNull();
  });
});
