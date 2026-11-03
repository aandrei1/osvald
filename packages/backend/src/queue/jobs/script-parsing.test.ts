import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { ScriptProductionFlow } from '../../flows/script-production-flow.js';
import type { Logger } from '../../lib/logger.js';
import {
  OcrServiceError,
  type OcrClient,
  type PdfTextResponse,
} from '../../services/ocr.client.js';
import {
  processScriptParsingJob,
  type ScriptParsingJobData,
  type ScriptParsingJobResult,
} from './script-parsing.js';

/**
 * The job is thin: it does the heavy work and reports through the flow. What
 * it must get right is *when* it reports: never for a stale run, and a failure
 * only once BullMQ will not try again.
 */

const RUN = {
  scriptId: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6b',
  runId: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6c',
};

const PAGE_TEXT = `ACTUL 1
SCENA 1

HARPAGON: Nimic, tată.
ÉLISE: Aici, tată.
`;

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

async function storedPdf(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'osvald-job-'));
  const path = join(directory, 'script.pdf');
  await writeFile(path, '%PDF-1.4 test');
  return path;
}

function fakeJob(
  data: unknown,
  options: { attemptsMade?: number; attempts?: number } = {},
): Job<ScriptParsingJobData, ScriptParsingJobResult> {
  return {
    data,
    attemptsMade: options.attemptsMade ?? 0,
    opts: { attempts: options.attempts ?? 3 },
    updateProgress: vi.fn(async () => undefined),
  } as unknown as Job<ScriptParsingJobData, ScriptParsingJobResult>;
}

function fakeFlow(options: { current?: boolean } = {}) {
  return {
    isRunCurrent: vi.fn(async () => options.current ?? true),
    onExtractionCompleted: vi.fn(async () => ({ kind: 'stage_changed' as const })),
    onExtractionFailed: vi.fn(async () => ({ kind: 'stage_changed' as const })),
  };
}

function fakeOcr(extract: () => Promise<PdfTextResponse>): OcrClient {
  return {
    extractPdfText: vi.fn(extract),
    recognizeImage: vi.fn(),
    isHealthy: vi.fn(async () => true),
  };
}

const extraction: PdfTextResponse = {
  pages: [{ page: 1, text: PAGE_TEXT, source: 'text-layer' }],
  page_count: 1,
  ocr_page_count: 0,
  engine: 'test',
  language: 'ro',
};

function context(flow: ReturnType<typeof fakeFlow>, ocr: OcrClient) {
  return {
    flow: flow as unknown as ScriptProductionFlow,
    logger: silentLogger,
    ocr,
    genders: { classify: () => 'unknown' as const },
  };
}

describe('processScriptParsingJob', () => {
  it('reports the parsed lines for the current run', async () => {
    const flow = fakeFlow();
    const filePath = await storedPdf();

    const result = await processScriptParsingJob(
      fakeJob({ ...RUN, filePath }),
      context(
        flow,
        fakeOcr(async () => extraction),
      ),
    );

    expect(result).toMatchObject({ ...RUN, stale: false, sceneCount: 1, lineCount: 2 });
    expect(flow.onExtractionCompleted).toHaveBeenCalledWith(RUN, expect.anything());
  });

  it('skips the OCR entirely for a run that is no longer current', async () => {
    const flow = fakeFlow({ current: false });
    const ocr = fakeOcr(async () => extraction);

    const result = await processScriptParsingJob(
      fakeJob({ ...RUN, filePath: await storedPdf() }),
      context(flow, ocr),
    );

    expect(result.stale).toBe(true);
    expect(ocr.extractPdfText).not.toHaveBeenCalled();
    expect(flow.onExtractionCompleted).not.toHaveBeenCalled();
  });

  it('leaves the script extracting while BullMQ still retries', async () => {
    const flow = fakeFlow();
    const ocr = fakeOcr(async () => {
      throw new OcrServiceError('OCR service responded with HTTP 503', 503);
    });

    await expect(
      processScriptParsingJob(
        fakeJob({ ...RUN, filePath: await storedPdf() }, { attemptsMade: 0, attempts: 3 }),
        context(flow, ocr),
      ),
    ).rejects.toThrow('HTTP 503');

    expect(flow.onExtractionFailed).not.toHaveBeenCalled();
  });

  it('reports the failure on the last attempt', async () => {
    const flow = fakeFlow();
    const ocr = fakeOcr(async () => {
      throw new OcrServiceError('OCR service responded with HTTP 503', 503);
    });

    await expect(
      processScriptParsingJob(
        fakeJob({ ...RUN, filePath: await storedPdf() }, { attemptsMade: 2, attempts: 3 }),
        context(flow, ocr),
      ),
    ).rejects.toThrow('HTTP 503');

    expect(flow.onExtractionFailed).toHaveBeenCalledWith(RUN, {
      message: 'OCR service responded with HTTP 503',
    });
  });

  it('reports a failure that cannot improve at once, and skips the retries', async () => {
    const flow = fakeFlow();
    const ocr = fakeOcr(async () => {
      throw new OcrServiceError('Not a PDF', 400);
    });

    await expect(
      processScriptParsingJob(
        fakeJob({ ...RUN, filePath: await storedPdf() }, { attemptsMade: 0, attempts: 3 }),
        context(flow, ocr),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(flow.onExtractionFailed).toHaveBeenCalledWith(RUN, { message: 'Not a PDF' });
  });

  it('rejects job data without a run id, as queued before the flow existed', async () => {
    const flow = fakeFlow();

    await expect(
      processScriptParsingJob(
        fakeJob({ scriptId: RUN.scriptId, filePath: '/x.pdf', mimeType: 'application/pdf' }),
        context(
          flow,
          fakeOcr(async () => extraction),
        ),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(flow.isRunCurrent).not.toHaveBeenCalled();
  });
});
