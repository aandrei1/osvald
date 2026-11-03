import { readFile } from 'node:fs/promises';

import { idSchema } from '@osvald/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { ScriptProductionFlow } from '../../flows/script-production-flow.js';
import type { Logger } from '../../lib/logger.js';
import type { GenderClassifier } from '../../parsing/gender/gender-classifier.js';
import { parseScriptText } from '../../parsing/script-parser.js';
import type { ExtractionJob, RunRef } from '../../ports/extraction-queue.js';
import {
  OcrServiceError,
  type OcrClient,
  type PdfTextResponse,
} from '../../services/ocr.client.js';

/** Queue name used by the API (producer) and the worker (consumer). */
export const SCRIPT_PARSING_QUEUE = 'script-parsing';

export const scriptParsingJobDataSchema = z.object({
  scriptId: idSchema,
  /** The run this job belongs to; reactions with an older run are ignored. */
  runId: idSchema,
  /** Absolute path of the stored upload. */
  filePath: z.string().min(1),
}) satisfies z.ZodType<ExtractionJob>;
export type ScriptParsingJobData = z.infer<typeof scriptParsingJobDataSchema>;

export const scriptParsingJobResultSchema = z.object({
  scriptId: idSchema,
  runId: idSchema,
  /** The run was no longer current (reparsed or deleted), so nothing was saved. */
  stale: z.boolean(),
  sceneCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type ScriptParsingJobResult = z.infer<typeof scriptParsingJobResultSchema>;

export interface ScriptParsingContext {
  flow: ScriptProductionFlow;
  logger: Logger;
  ocr: OcrClient;
  genders: GenderClassifier;
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

/** BullMQ will not try again after this attempt. */
function isLastAttempt(job: Job<ScriptParsingJobData, ScriptParsingJobResult>): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function staleResult(run: RunRef, startedAt: number): ScriptParsingJobResult {
  return {
    ...run,
    stale: true,
    sceneCount: 0,
    characterCount: 0,
    lineCount: 0,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Runs one extraction: PDF → text → scenes/characters/lines.
 *
 *   1. skip the work when the run is no longer current
 *   2. hand the file to the OCR service, which reads the text layer where there
 *      is one and recognises the pages that have none
 *   3. parse the text into scenes, characters and lines
 *   4. report back through `onExtractionCompleted`, which saves the lines and
 *      moves the script to review in one transaction
 *
 * A failure is reported through `onExtractionFailed` only after the last
 * attempt, so the script stays `extracting` while BullMQ retries. Problems that
 * cannot improve on retry (a malformed PDF, a missing OCR stack) are thrown as
 * `UnrecoverableError` to skip the backoff.
 */
export async function processScriptParsingJob(
  job: Job<ScriptParsingJobData, ScriptParsingJobResult>,
  ctx: ScriptParsingContext,
): Promise<ScriptParsingJobResult> {
  const startedAt = Date.now();
  const parsedData = scriptParsingJobDataSchema.safeParse(job.data);

  if (!parsedData.success) {
    // Jobs queued before run ids existed land here. The recovery job queues
    // their scripts again under the current run.
    throw new UnrecoverableError(`Invalid job data: ${parsedData.error.message}`);
  }

  const data = parsedData.data;
  const run: RunRef = { scriptId: data.scriptId, runId: data.runId };

  if (!(await ctx.flow.isRunCurrent(run))) {
    ctx.logger.info(`skipping run ${run.runId} of script ${run.scriptId}: no longer current`);
    return staleResult(run, startedAt);
  }

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

    const genderByName = new Map(
      parsed.characters.map((character) => [character.name, ctx.genders.classify(character)]),
    );

    const outcome = await ctx.flow.onExtractionCompleted(run, { parsed, genderByName });
    await job.updateProgress(PROGRESS.saved);

    if (outcome.kind === 'stale') {
      ctx.logger.info(`discarded run ${run.runId} of script ${run.scriptId}: no longer current`);
      return staleResult(run, startedAt);
    }

    const lineCount = parsed.scenes.reduce((total, scene) => total + scene.lines.length, 0);
    ctx.logger.info(
      `parsed script ${run.scriptId}: ${parsed.scenes.length} scene(s), ` +
        `${parsed.characters.length} character(s), ${lineCount} line(s)`,
    );

    return {
      ...run,
      stale: false,
      sceneCount: parsed.scenes.length,
      characterCount: parsed.characters.length,
      lineCount,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parsing failure';

    // A client error from the OCR service (bad PDF, missing OCR stack) will fail
    // identically on every attempt, so skip the retries.
    const unrecoverable =
      error instanceof UnrecoverableError || (error instanceof OcrServiceError && !error.retryable);

    if (unrecoverable || isLastAttempt(job)) {
      await ctx.flow.onExtractionFailed(run, { message }).catch((writeError: unknown) => {
        // The job failure must still surface; the recovery job fails the run later.
        ctx.logger.error('could not record the extraction failure', writeError);
      });
    }

    if (unrecoverable && !(error instanceof UnrecoverableError)) {
      throw new UnrecoverableError(message);
    }

    throw error;
  }
}
