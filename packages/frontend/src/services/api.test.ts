import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noContentSchema } from '@osvald/shared';

import { ApiError, request } from './api';

const schema = noContentSchema;

function okResponse(): Response {
  return new Response(null, { status: 204 });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('request retry and timeout', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries a GET after a gateway error and returns the later success', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'bad gateway' }, 502))
      .mockResolvedValueOnce(okResponse());

    const pending = request('/x', schema);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a GET after a network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse());

    const pending = request('/x', schema);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and surfaces the last response', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ message: 'unavailable' }, 503)),
    );

    const pending = request('/x', schema);
    const assertion = expect(pending).rejects.toMatchObject({ status: 503 });
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'bad gateway' }, 502));

    await expect(request('/x', schema, { method: 'POST', body: {} })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry client errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'nope' }, 404));

    await expect(request('/x', schema)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the caller aborts', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    await expect(request('/x', schema, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a timed-out POST as an ApiError', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Timed out', 'TimeoutError'));
          });
        }),
    );

    const pending = request('/x', schema, { method: 'POST', body: {} });
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'ApiError',
      message: 'The request timed out',
    });
    await vi.advanceTimersByTimeAsync(15_001);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
