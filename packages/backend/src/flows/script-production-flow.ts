import { randomUUID } from 'node:crypto';

import {
  canRunStep,
  type Character,
  type Gender,
  type LossSummary,
  type Script,
  type ScriptFlowStep,
  type ScriptStage,
  type WorkspacePermission,
} from '@osvald/shared';
import { and, count, eq, lt } from 'drizzle-orm';

import type { Database, Executor } from '../db/client.js';
import { characters } from '../db/schema/characters.js';
import { lines } from '../db/schema/lines.js';
import { scenes } from '../db/schema/scenes.js';
import { scripts, type ScriptRow } from '../db/schema/scripts.js';
import { BadRequestError, ConflictError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { ParsedScript } from '../parsing/script-parser.js';
import type { Clock } from '../ports/clock.js';
import type { ExtractionQueue, RunRef } from '../ports/extraction-queue.js';
import type { SourceFileStore } from '../ports/source-file-store.js';
import {
  insertScript,
  mapScriptRow,
  saveParseResult,
  setCharacterGender,
} from '../services/script.service.js';
import { authorizeScript, authorizeWorkspace, type Actor } from './authorization.js';

export type { Actor } from './authorization.js';
export type { RunRef } from '../ports/extraction-queue.js';

/** A PDF the upload route has already streamed to disk. */
export interface UploadedPdf {
  fileName: string;
  storedPath: string;
  title: string;
  author: string | null;
  description: string | null;
}

export interface ExtractionResult {
  parsed: ParsedScript;
  genderByName: ReadonlyMap<string, Gender>;
}

export interface ExtractionError {
  message: string;
}

/** A command or reaction moved the script into stage `S`. */
export interface StageChanged<S extends ScriptStage> {
  kind: 'stage_changed';
  script: Script & { stage: S };
}

export interface CharacterUpdated {
  kind: 'character_updated';
  character: Character;
}

/** A reaction for a run that is no longer current (reparsed, deleted, already handled). */
export interface StaleReaction {
  kind: 'stale';
  run: RunRef;
}

export interface RecoveryReport {
  /** Runs that sat in `extracting` past the grace period. */
  checked: number;
  /** Runs whose job was missing and has been queued again. */
  requeued: number;
  /** Runs whose job had failed for good without telling the flow. */
  failed: number;
}

/** The script changed between reading it and writing it. */
export class StageConflictError extends ConflictError {
  constructor(scriptId: string) {
    super(`Script "${scriptId}" changed in the meantime; reload it and try again`);
    this.name = 'StageConflictError';
  }
}

export interface ScriptProductionFlowDeps {
  db: Database;
  extractionQueue: ExtractionQueue;
  sourceFiles: SourceFileStore;
  clock: Clock;
  logger: Logger;
  /** Run id generator; tests pin it. */
  newRunId?: () => string;
}

/** What the stage moved from, used as the condition of the update. */
interface ExpectedState {
  id: string;
  stage: ScriptStage;
  runId: string;
}

function stageChanged<S extends ScriptStage>(row: ScriptRow, stage: S): StageChanged<S> {
  return { kind: 'stage_changed', script: { ...mapScriptRow(row), stage } };
}

function stale(run: RunRef): StaleReaction {
  return { kind: 'stale', run };
}

/**
 * The production flow of a script: import → review → synthesis → rehearsal.
 *
 * Commands come from people and reactions (`on…`) come from jobs. Both save and
 * answer at once with the new stage, never with the result of the work. Every
 * method follows the same steps:
 *
 *   1. authorize the actor;
 *   2. check the transition against `SCRIPT_TRANSITIONS`;
 *   3. do the work through the ports;
 *   4. change the stage with `UPDATE … WHERE stage = <expected> AND run_id = <expected>`.
 *
 * The stage saved in Postgres is the thread of the flow. A reaction whose run id
 * is no longer the script's is ignored, so an old job cannot overwrite a newer
 * reparse.
 *
 * TODO: [Etapa 3] reviseLine and castVoice; limit confirmGender to `in_review` and `ready`.
 * TODO: [Etapa 4] previewVoice, estimateSynthesis, submitForSynthesis, stopSynthesis, resumeSynthesis
 * and the synthesis reactions.
 */
export class ScriptProductionFlow {
  private readonly db: Database;
  private readonly extractionQueue: ExtractionQueue;
  private readonly sourceFiles: SourceFileStore;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly newRunId: () => string;

  constructor(deps: ScriptProductionFlowDeps) {
    this.db = deps.db;
    this.extractionQueue = deps.extractionQueue;
    this.sourceFiles = deps.sourceFiles;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.newRunId = deps.newRunId ?? randomUUID;
  }

  /* ------------------------------------------------------------------------ */
  /* Commands                                                                 */
  /* ------------------------------------------------------------------------ */

  async startImport(
    actor: Actor,
    workspaceId: string,
    file: UploadedPdf,
  ): Promise<StageChanged<'extracting'>> {
    await authorizeWorkspace(this.db, actor, workspaceId, 'script:import');

    const now = this.clock.now();
    const row = await insertScript(this.db, {
      workspaceId,
      userId: actor.userId,
      title: file.title,
      author: file.author,
      description: file.description,
      sourceFileName: file.fileName,
      sourceFilePath: file.storedPath,
      stage: 'extracting',
      stageEnteredAt: now,
      runId: this.newRunId(),
    });

    await this.enqueueExtraction(row, file.storedPath);
    return stageChanged(row, 'extracting');
  }

  /** What a reparse would replace. Manual genders survive it and are not counted. */
  async previewReparse(actor: Actor, scriptId: string): Promise<LossSummary> {
    const row = await this.authorize(actor, scriptId, 'script:reparse');
    return this.lossSummary(row.id);
  }

  /**
   * Extracts the stored PDF again under a new run id.
   *
   * The current lines stay until the new extraction completes. Text the editor
   * corrected by hand is lost then, which `previewReparse` warns about.
   */
  async reparse(actor: Actor, scriptId: string): Promise<StageChanged<'extracting'>> {
    const row = await this.authorize(actor, scriptId, 'script:reparse');
    this.assertCanRun('reparse', row);

    if (row.sourceFilePath === null) {
      throw new BadRequestError('This script has no stored source file, so it cannot be re-parsed');
    }

    const updated = await this.changeStage(this.db, row, 'extracting', {
      runId: this.newRunId(),
      parseError: null,
    });

    await this.enqueueExtraction(updated, row.sourceFilePath);
    return stageChanged(updated, 'extracting');
  }

  async previewDelete(actor: Actor, scriptId: string): Promise<LossSummary> {
    const row = await this.authorize(actor, scriptId, 'script:delete');
    return this.lossSummary(row.id);
  }

  /** Removes the script and everything parsed from it; a running job's reaction then goes stale. */
  async delete(actor: Actor, scriptId: string): Promise<void> {
    const row = await this.authorize(actor, scriptId, 'script:delete');
    this.assertCanRun('delete', row);

    await this.db.delete(scripts).where(eq(scripts.id, row.id));

    if (row.sourceFilePath !== null) {
      await this.sourceFiles.remove(row.sourceFilePath);
    }
  }

  /** Corrects a role's gender; `manual` keeps it through every reparse. */
  async confirmGender(
    actor: Actor,
    scriptId: string,
    characterId: string,
    gender: Gender,
  ): Promise<CharacterUpdated> {
    const row = await this.authorize(actor, scriptId, 'script:edit');
    const character = await setCharacterGender(this.db, row.id, characterId, gender);
    return { kind: 'character_updated', character };
  }

  /* ------------------------------------------------------------------------ */
  /* Reactions                                                                */
  /* ------------------------------------------------------------------------ */

  /** Whether `run` is still the script's work in progress; jobs check it before heavy work. */
  async isRunCurrent(run: RunRef): Promise<boolean> {
    const [row] = await this.db
      .select({ stage: scripts.stage })
      .from(scripts)
      .where(and(eq(scripts.id, run.scriptId), eq(scripts.runId, run.runId)));

    return row !== undefined && row.stage === 'extracting';
  }

  /** Saves the lines and moves the script to review, in one transaction. */
  async onExtractionCompleted(
    run: RunRef,
    result: ExtractionResult,
  ): Promise<StageChanged<'in_review'> | StaleReaction> {
    return this.db.transaction(async (tx) => {
      const pageCount = result.parsed.stats.pageCount;

      // The conditional update goes first: it takes the row lock, so a
      // concurrent reparse waits for this transaction instead of interleaving.
      const row = await this.tryChangeStage(tx, run, 'onExtractionCompleted', 'in_review', {
        parseError: null,
        pageCount: pageCount > 0 ? pageCount : null,
      });

      if (row === null) {
        return stale(run);
      }

      await saveParseResult(tx, run.scriptId, result.parsed, {
        genderByName: result.genderByName,
      });

      return stageChanged(row, 'in_review');
    });
  }

  /** Records why extraction gave up. Jobs call it only after their last attempt. */
  async onExtractionFailed(
    run: RunRef,
    error: ExtractionError,
  ): Promise<StageChanged<'failed'> | StaleReaction> {
    const row = await this.tryChangeStage(this.db, run, 'onExtractionFailed', 'failed', {
      parseError: error.message,
    });

    return row === null ? stale(run) : stageChanged(row, 'failed');
  }

  /**
   * Re-queues extractions that have sat in `extracting` longer than
   * `graceMs`. Run by the periodic recovery job.
   *
   * Enqueueing is idempotent per run, so a run whose job is still waiting or
   * running is left alone. A run whose job failed for good without reaching
   * `onExtractionFailed` (a worker that crashed past BullMQ's stall limit) is
   * failed here instead.
   *
   * TODO: [Etapa 4] Recover runs stuck in `synthesizing` the same way.
   */
  async recoverStuckExtractions(options: { graceMs: number }): Promise<RecoveryReport> {
    const cutoff = new Date(this.clock.now().getTime() - options.graceMs);
    const report: RecoveryReport = { checked: 0, requeued: 0, failed: 0 };

    const stuck = await this.db
      .select({ id: scripts.id, runId: scripts.runId, sourceFilePath: scripts.sourceFilePath })
      .from(scripts)
      .where(and(eq(scripts.stage, 'extracting'), lt(scripts.stageEnteredAt, cutoff)));

    for (const script of stuck) {
      report.checked += 1;
      const run: RunRef = { scriptId: script.id, runId: script.runId };

      const failure =
        script.sourceFilePath === null
          ? 'This script has no stored source file to extract'
          : await this.extractionQueue.failureOf(run);

      if (failure !== null) {
        const outcome = await this.onExtractionFailed(run, { message: failure });
        if (outcome.kind === 'stage_changed') {
          report.failed += 1;
        }
        continue;
      }

      if (script.sourceFilePath !== null) {
        const outcome = await this.extractionQueue.enqueue({
          ...run,
          filePath: script.sourceFilePath,
        });
        if (outcome === 'added') {
          report.requeued += 1;
        }
      }
    }

    return report;
  }

  /* ------------------------------------------------------------------------ */
  /* Steps shared by every method                                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Loads the script if the actor's workspace role allows `permission`. A
   * script outside the actor's workspaces answers 404, like a missing one.
   */
  private async authorize(
    actor: Actor,
    scriptId: string,
    permission: WorkspacePermission,
  ): Promise<ScriptRow> {
    return authorizeScript(this.db, actor, scriptId, permission);
  }

  private assertCanRun(step: ScriptFlowStep, row: ScriptRow): void {
    if (!canRunStep(step, row.stage)) {
      throw new ConflictError(`"${step}" is not possible while the script is ${row.stage}`);
    }
  }

  /** Conditional stage change for a command; a lost race becomes a 409. */
  private async changeStage(
    executor: Executor,
    expected: ExpectedState,
    to: ScriptStage,
    changes: { runId?: string; parseError?: string | null } = {},
  ): Promise<ScriptRow> {
    const now = this.clock.now();
    const [row] = await executor
      .update(scripts)
      .set({ ...changes, stage: to, stageEnteredAt: now, updatedAt: now })
      .where(
        and(
          eq(scripts.id, expected.id),
          eq(scripts.stage, expected.stage),
          eq(scripts.runId, expected.runId),
        ),
      )
      .returning();

    if (row === undefined) {
      throw new StageConflictError(expected.id);
    }

    return row;
  }

  /**
   * Conditional stage change for a reaction: only the current run, only from a
   * stage the step allows. Returns `null` when the reaction is stale.
   */
  private async tryChangeStage(
    executor: Executor,
    run: RunRef,
    step: 'onExtractionCompleted' | 'onExtractionFailed',
    to: ScriptStage,
    changes: { parseError?: string | null; pageCount?: number | null },
  ): Promise<ScriptRow | null> {
    const [current] = await executor
      .select({ stage: scripts.stage })
      .from(scripts)
      .where(and(eq(scripts.id, run.scriptId), eq(scripts.runId, run.runId)))
      .for('update');

    if (current === undefined || !canRunStep(step, current.stage)) {
      return null;
    }

    const now = this.clock.now();
    const [row] = await executor
      .update(scripts)
      .set({ ...changes, stage: to, stageEnteredAt: now, updatedAt: now })
      .where(
        and(
          eq(scripts.id, run.scriptId),
          eq(scripts.runId, run.runId),
          eq(scripts.stage, current.stage),
        ),
      )
      .returning();

    return row ?? null;
  }

  /**
   * Hands the run to the queue. A failure here is logged, not thrown: the
   * stage is already saved, and the recovery job queues the run again.
   */
  private async enqueueExtraction(row: ScriptRow, filePath: string): Promise<void> {
    try {
      await this.extractionQueue.enqueue({ scriptId: row.id, runId: row.runId, filePath });
    } catch (error) {
      this.logger.warn(
        `could not queue the extraction of script ${row.id}; the recovery job will retry`,
        error,
      );
    }
  }

  private async lossSummary(scriptId: string): Promise<LossSummary> {
    const [sceneCount, characterCount, [lineRow]] = await Promise.all([
      this.db.$count(scenes, eq(scenes.scriptId, scriptId)),
      this.db.$count(characters, eq(characters.scriptId, scriptId)),
      this.db
        .select({ value: count() })
        .from(lines)
        .innerJoin(scenes, eq(lines.sceneId, scenes.id))
        .where(eq(scenes.scriptId, scriptId)),
    ]);

    return {
      sceneCount,
      lineCount: lineRow?.value ?? 0,
      characterCount,
      // TODO: [Etapa 3] Count lines whose text the editor revised.
      editedLineCount: 0,
      // TODO: [Etapa 4] Sum the Azure characters behind this script's stored audio.
      synthesizedCharacterCount: 0,
    };
  }
}
