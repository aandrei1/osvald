import { readFile } from 'node:fs/promises';

import { idSchema } from '@osvald/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';
import { parseScriptText } from '../../parsing/script-parser.js';
import {
  OcrServiceError,
  type OcrClient,
  type PdfTextResponse,
} from '../../services/ocr.client.js';
import { saveParseResult, updateScriptStatus } from '../../services/script.service.js';

/** Queue name used by the API (producer) and the worker (consumer). */
export const SCRIPT_PARSING_QUEUE = 'script-parsing';

export const scriptParsingJobDataSchema = z.object({
  scriptId: idSchema,
  /** Absolute path of the stored upload. */
  filePath: z.string().min(1),
  /** Validated at upload time; the worker can re-check before parsing. */
  mimeType: z.string().min(1),
  /** Owner at the time of upload, `null` for anonymous uploads. */
  requestedByUserId: idSchema.nullable(),
});
export type ScriptParsingJobData = z.infer<typeof scriptParsingJobDataSchema>;

export const scriptParsingJobResultSchema = z.object({
  scriptId: idSchema,
  sceneCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type ScriptParsingJobResult = z.infer<typeof scriptParsingJobResultSchema>;

export interface ScriptParsingContext {
  db: Database;
  logger: Logger;
  ocr: OcrClient;
}

/** Progress milestones, so the UI can show more than a spinner. */
const PROGRESS = { started: 5, extracted: 55, parsed: 75, saved: 100 } as const;

/**
 * Joins the per-page text back into one document.
 *
 * The page markers are re-added in the format the parser's cleanup pass expects
 * (`=== PAGINA n ===`), which is what lets it strip running headers and give
 * scenes a page range.
 */
function toMarkedUpText(extraction: PdfTextResponse): string {
  return extraction.pages.map((page) => `=== PAGINA ${page.page} ===\n${page.text}\n`).join('\n');
}

/** Human-readable reason why a document yielded nothing usable. */
function describeEmptyResult(extraction: PdfTextResponse): string {
  const skipped = extraction.pages.filter((page) => page.source === 'skipped').length;
  const failed = extraction.pages.filter((page) => page.source === 'error').length;

  if (skipped > 0) {
    return (
      `${skipped} page(s) have no text layer and the OCR page budget was spent. ` +
      'Raise OCR_MAX_OCR_PAGES on the OCR service, or upload a shorter excerpt.'
    );
  }

  if (failed === extraction.pages.length) {
    return 'Every page failed to extract — the file may be corrupt or password-protected.';
  }

  return (
    'No dialogue could be recognised. The parser expects a printed play: ' +
    'uppercase speaker labels ending in a colon, under ACTUL / SCENA headings.'
  );
}

/**
 * Runs one script-parsing job: PDF → text → scenes/characters/lines.
 *
 *   1. mark the script `parsing`
 *   2. hand the file to the OCR service, which reads the text layer where there
 *      is one and recognises the pages that have none
 *   3. parse the text into scenes, characters and lines
 *   4. persist the result in one transaction and mark the script `parsed`
 *
 * Failures are recorded on the script row (`status: 'failed'` plus
 * `parse_error`) so the UI can explain what went wrong, then rethrown so BullMQ
 * records the attempt. Problems that cannot improve on retry — a malformed PDF,
 * a missing OCR stack — are thrown as `UnrecoverableError` to skip the backoff.
 */
export async function processScriptParsingJob(
  job: Job<ScriptParsingJobData, ScriptParsingJobResult>,
  ctx: ScriptParsingContext,
): Promise<ScriptParsingJobResult> {
  const startedAt = Date.now();
  const data = scriptParsingJobDataSchema.parse(job.data);

  await updateScriptStatus(ctx.db, data.scriptId, 'parsing');
  await job.updateProgress(PROGRESS.started);

  try {
    const pdf = await readFile(data.filePath).catch((error: unknown) => {
      throw new UnrecoverableError(
        `Stored upload ${data.filePath} could not be read: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });

    ctx.logger.info(`extracting text from ${data.filePath} (${pdf.byteLength} bytes)`);

    const extraction = await ctx.ocr.extractPdfText(pdf, 'script.pdf', {
      language: env.OCR_LANGUAGE,
    });

    await job.updateProgress(PROGRESS.extracted);
    ctx.logger.info(
      `extracted ${extraction.pages.length}/${extraction.page_count} page(s) ` +
        `via ${extraction.engine} (${extraction.ocr_page_count} OCR'd)`,
    );

    const parsed = parseScriptText(toMarkedUpText(extraction));
    await job.updateProgress(PROGRESS.parsed);

    const dialogueCount = parsed.scenes.reduce(
      (total, scene) => total + scene.lines.filter((line) => line.type === 'dialogue').length,
      0,
    );

    // A parse that found no dialogue is a failure, not an empty success: the
    // rehearsal view would have nothing to play.
    if (dialogueCount === 0) {
      throw new UnrecoverableError(describeEmptyResult(extraction));
    }

    const summary = await saveParseResult(ctx.db, data.scriptId, parsed);
    await job.updateProgress(PROGRESS.saved);

    ctx.logger.info(
      `parsed script ${data.scriptId}: ${summary.sceneCount} scene(s), ` +
        `${summary.characterCount} character(s), ${summary.lineCount} line(s)`,
    );

    return {
      scriptId: data.scriptId,
      sceneCount: summary.sceneCount,
      characterCount: summary.characterCount,
      lineCount: summary.lineCount,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parsing failure';

    await updateScriptStatus(ctx.db, data.scriptId, 'failed', message).catch(
      (writeError: unknown) => {
        // The job failure must still surface even if the status write fails.
        ctx.logger.error('could not record the parse failure', writeError);
      },
    );

    // A client error from the OCR service (bad PDF, missing OCR stack) will fail
    // identically on every attempt, so skip the retries.
    if (error instanceof OcrServiceError && !error.retryable) {
      throw new UnrecoverableError(message);
    }

    throw error;
  }
}
