import { describe, expect, it } from 'vitest';

import { timeIt, withTimeout } from './async.js';

describe('withTimeout', () => {
  it('resolves when the operation settles in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 100, 'probe')).resolves.toBe('done');
  });

  it('rejects with a labelled timeout error', async () => {
    await expect(withTimeout(new Promise(() => undefined), 5, 'database')).rejects.toThrow(
      'database timed out after 5ms',
    );
  });

  it('does not leak an unhandled rejection when the losing promise settles later', async () => {
    const slow = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('too late')), 20);
    });

    await expect(withTimeout(slow, 5, 'probe')).rejects.toThrow('probe timed out after 5ms');

    // Let the losing promise reject; a missing handler would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});

describe('timeIt', () => {
  it('returns the result and a non-negative duration', async () => {
    const { result, durationMs } = await timeIt(async () => 42);

    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates the operation error', async () => {
    await expect(
      timeIt(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
