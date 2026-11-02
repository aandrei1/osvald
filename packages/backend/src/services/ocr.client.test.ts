import type * as Undici from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof Undici>()),
  fetch: fetchMock,
}));

const { OcrServiceError, createOcrClient } = await import('./ocr.client.js');

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

async function extractionError(): Promise<InstanceType<typeof OcrServiceError>> {
  const error: unknown = await createOcrClient()
    .extractPdfText(PDF, 'script.pdf')
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(OcrServiceError);
  return error as InstanceType<typeof OcrServiceError>;
}

describe('OcrServiceError', () => {
  it('treats server errors as retryable and client errors as final', () => {
    expect(new OcrServiceError('boom', 500).retryable).toBe(true);
    expect(new OcrServiceError('bad pdf', 422).retryable).toBe(false);
    expect(new OcrServiceError('no paddle', 501).retryable).toBe(false);
  });

  it('lets the caller override the default', () => {
    expect(new OcrServiceError('slow', 504, false).retryable).toBe(false);
  });
});

describe('createOcrClient().extractPdfText', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('does not retry a timeout, which would take just as long again', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'TimeoutError'));

    const error = await extractionError();

    expect(error.statusCode).toBe(504);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('OCR_PDF_TIMEOUT_MS');
  });

  it('retries when the service cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await extractionError();

    expect(error.statusCode).toBe(503);
    expect(error.retryable).toBe(true);
  });
});
