/** Small async utilities shared by the service layer. */

/** Rejects if `operation` does not settle within `timeoutMs`. */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  // The losing promise of Promise.race is not awaited, so attach a no-op
  // handler first to avoid an unhandled rejection if it settles later.
  operation.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Runs `operation` and reports how long it took, so probes can report latency. */
export async function timeIt<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const startedAt = performance.now();
  const result = await operation();
  return { result, durationMs: Math.round(performance.now() - startedAt) };
}
