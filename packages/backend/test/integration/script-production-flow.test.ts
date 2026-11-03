import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/client.js';
import { characters } from '../../src/db/schema/characters.js';
import { scenes } from '../../src/db/schema/scenes.js';
import { scripts } from '../../src/db/schema/scripts.js';
import { workspaceMembers } from '../../src/db/schema/workspaces.js';
import {
  ScriptProductionFlow,
  StageConflictError,
  type Actor,
  type ExtractionResult,
  type RunRef,
} from '../../src/flows/script-production-flow.js';
import { ForbiddenError, NotFoundError } from '../../src/lib/errors.js';
import type { Logger } from '../../src/lib/logger.js';
import { parseScriptText } from '../../src/parsing/script-parser.js';
import { createFakeClock, createFakeExtractionQueue } from '../helpers/fakes.js';
import { addMember, insertUserWithWorkspace, tryCreateTestDatabase } from '../helpers/database.js';

/**
 * `ScriptProductionFlow` against the real schema, with fake ports.
 *
 * Postgres is real on purpose: the flow's guarantees (conditional stage
 * changes, the run-id check, the reaction's single transaction) are properties
 * of the SQL it runs, not of the code around it. The queue, the file store and
 * the clock are fakes, so a test can lose a job, fail one, or move time.
 */

const database = await tryCreateTestDatabase();

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database?.truncate();
});

function db(): Database {
  if (database === null) {
    throw new Error('test database unavailable');
  }
  return database.db;
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const PLAY = `=== PAGINA 1 ===
ACTUL 1
SCENA 1

HARPAGON: Nimic, tată.
(Valère intră.)
ÉLISE: Aici, tată.
`;

function extractionOf(text: string): ExtractionResult {
  return { parsed: parseScriptText(text), genderByName: new Map() };
}

const GRACE_MS = 60_000;

function createFlow() {
  const extraction = createFakeExtractionQueue();
  const sourceFiles = { remove: vi.fn(async () => undefined) };
  const clock = createFakeClock();

  const flow = new ScriptProductionFlow({
    db: db(),
    extractionQueue: extraction,
    sourceFiles,
    clock,
    logger: silentLogger,
  });

  return { flow, extraction, sourceFiles, clock };
}

/** An editor of their own personal workspace. */
async function createActor(): Promise<Actor & { workspaceId: string }> {
  const user = await insertUserWithWorkspace(db());
  return { userId: user.id, workspaceId: user.workspaceId };
}

/** A plain member of `editor`'s workspace. */
async function createMemberOf(editor: { workspaceId: string }): Promise<Actor> {
  const user = await insertUserWithWorkspace(db());
  await addMember(db(), editor.workspaceId, user.id);
  return { userId: user.id };
}

function upload(storedPath = '/uploads/avarul.pdf') {
  return { fileName: 'avarul.pdf', storedPath, title: 'Avarul', author: null, description: null };
}

async function scriptRow(scriptId: string) {
  const [row] = await db().select().from(scripts).where(eq(scripts.id, scriptId));
  return row;
}

async function sceneCount(scriptId: string): Promise<number> {
  return db().$count(scenes, eq(scenes.scriptId, scriptId));
}

/**
 * Holds a lock on the script row while `start` launches its commands, and
 * releases it only once `waiters` of them are blocked on it. Plain reads are
 * not blocked, so every command has read the same state before any writes.
 */
async function withRowLocked<T>(
  scriptId: string,
  waiters: number,
  start: () => Promise<T>[],
): Promise<PromiseSettledResult<T>[]> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });

  const holder = db().transaction(async (tx) => {
    await tx.select().from(scripts).where(eq(scripts.id, scriptId)).for('update');
    locked();
    await released;
  });

  await isLocked;
  const commands = start();

  const deadline = Date.now() + 5_000;
  for (;;) {
    const [row] = await db().execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((row?.waiting ?? 0) >= waiters) {
      break;
    }
    if (Date.now() > deadline) {
      release();
      throw new Error(`only ${row?.waiting ?? 0} of ${waiters} commands reached the lock`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  release();
  await holder;
  return Promise.allSettled(commands);
}

/** The run the last enqueued job belongs to. */
function lastRun(extraction: ReturnType<typeof createFakeExtractionQueue>): RunRef {
  const job = extraction.jobs.at(-1);
  if (job === undefined) {
    throw new Error('no extraction job was queued');
  }
  return { scriptId: job.scriptId, runId: job.runId };
}

describe.skipIf(database === null)('ScriptProductionFlow', () => {
  describe('startImport', () => {
    it('saves the script in extracting and queues its run', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();

      const changed = await flow.startImport(actor, actor.workspaceId, upload());

      expect(changed.script.stage).toBe('extracting');
      expect(changed.script.stageEnteredAt).toBe(clock.now().toISOString());

      const row = await scriptRow(changed.script.id);
      expect(extraction.jobs).toEqual([
        { scriptId: changed.script.id, runId: row?.runId, filePath: '/uploads/avarul.pdf' },
      ]);
    });

    it('keeps the script when the queue is down, for recovery to pick up', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();
      extraction.enqueue.mockRejectedValueOnce(new Error('Redis unreachable'));

      const changed = await flow.startImport(actor, actor.workspaceId, upload());
      expect(changed.script.stage).toBe('extracting');
      expect(extraction.jobs).toHaveLength(0);

      clock.advance(GRACE_MS + 1);
      const report = await flow.recoverStuckExtractions({ graceMs: GRACE_MS });

      expect(report).toEqual({ checked: 1, requeued: 1, failed: 0 });
      expect(extraction.jobs[0]?.scriptId).toBe(changed.script.id);
    });
  });

  describe('extraction reactions', () => {
    it('saves the lines and moves the script to review in one step', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());

      clock.advance(5_000);
      const outcome = await flow.onExtractionCompleted(lastRun(extraction), extractionOf(PLAY));

      expect(outcome.kind).toBe('stage_changed');
      const row = await scriptRow(script.id);
      expect(row?.stage).toBe('in_review');
      expect(row?.stageEnteredAt.toISOString()).toBe(clock.now().toISOString());
      expect(await sceneCount(script.id)).toBe(1);
    });

    it('ignores a duplicate completion of the same run', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      await flow.startImport(actor, actor.workspaceId, upload());
      const run = lastRun(extraction);

      await flow.onExtractionCompleted(run, extractionOf(PLAY));
      const second = await flow.onExtractionCompleted(run, extractionOf(PLAY));

      expect(second).toEqual({ kind: 'stale', run });
    });

    it('records the failure reason of the current run', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());

      const outcome = await flow.onExtractionFailed(lastRun(extraction), {
        message: 'Every page failed to extract',
      });

      expect(outcome.kind).toBe('stage_changed');
      const row = await scriptRow(script.id);
      expect(row?.stage).toBe('failed');
      expect(row?.parseError).toBe('Every page failed to extract');
    });

    it('ignores a reaction for a script that was deleted', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      const run = lastRun(extraction);

      await flow.delete(actor, script.id);

      await expect(flow.onExtractionCompleted(run, extractionOf(PLAY))).resolves.toEqual({
        kind: 'stale',
        run,
      });
      await expect(flow.isRunCurrent(run)).resolves.toBe(false);
    });
  });

  describe('reparse', () => {
    it('starts a new run and makes the old run stale', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      const oldRun = lastRun(extraction);

      await flow.reparse(actor, script.id);
      const newRun = lastRun(extraction);
      expect(newRun.runId).not.toBe(oldRun.runId);

      // The old job finishes late: nothing it found may land.
      await expect(flow.onExtractionCompleted(oldRun, extractionOf(PLAY))).resolves.toEqual({
        kind: 'stale',
        run: oldRun,
      });
      await expect(flow.onExtractionFailed(oldRun, { message: 'late' })).resolves.toEqual({
        kind: 'stale',
        run: oldRun,
      });
      expect((await scriptRow(script.id))?.stage).toBe('extracting');
      expect(await sceneCount(script.id)).toBe(0);

      await flow.onExtractionCompleted(newRun, extractionOf(PLAY));
      expect((await scriptRow(script.id))?.stage).toBe('in_review');
    });

    it('runs from failed and clears the old failure reason', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      await flow.onExtractionFailed(lastRun(extraction), { message: 'OCR down' });

      const changed = await flow.reparse(actor, script.id);

      expect(changed.script.stage).toBe('extracting');
      expect(changed.script.parseError).toBeNull();
    });

    it('lets only one of two simultaneous reparses through', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      await flow.onExtractionCompleted(lastRun(extraction), extractionOf(PLAY));
      const jobsBefore = extraction.jobs.length;

      // Two devices that both read `in_review` before either writes: both
      // updates queue behind the lock, and only the first still matches.
      const results = await withRowLocked(script.id, 2, () => [
        flow.reparse(actor, script.id),
        flow.reparse(actor, script.id),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.status === 'rejected' && rejected[0].reason).toBeInstanceOf(
        StageConflictError,
      );
      expect(extraction.jobs).toHaveLength(jobsBefore + 1);
    });

    it('never lets a completion and a reparse of the same run both win', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      const run = lastRun(extraction);

      const [completion, reparse] = await withRowLocked<unknown>(script.id, 2, () => [
        flow.onExtractionCompleted(run, extractionOf(PLAY)),
        flow.reparse(actor, script.id),
      ]);

      if (completion === undefined || reparse === undefined) {
        throw new Error('both commands must settle');
      }

      const row = await scriptRow(script.id);

      if (reparse.status === 'fulfilled') {
        // The reparse took the row first: the old run's lines were discarded.
        expect(completion).toEqual({ status: 'fulfilled', value: { kind: 'stale', run } });
        expect(row?.stage).toBe('extracting');
        expect(row?.runId).not.toBe(run.runId);
      } else {
        // The completion took it first: the reparse saw a changed stage.
        expect(reparse.reason).toBeInstanceOf(StageConflictError);
        expect(row?.stage).toBe('in_review');
        expect(row?.runId).toBe(run.runId);
      }
    });

    it('answers 404 for a script the actor cannot see', async () => {
      const { flow } = createFlow();
      const owner = await createActor();
      const stranger = await createActor();
      const { script } = await flow.startImport(owner, owner.workspaceId, upload());

      await expect(flow.reparse(stranger, script.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(flow.previewReparse(stranger, script.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('permissions', () => {
    it('lets only the editor import into a workspace', async () => {
      const { flow, extraction } = createFlow();
      const editor = await createActor();
      const member = await createMemberOf(editor);
      const stranger = await createActor();

      await expect(flow.startImport(member, editor.workspaceId, upload())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(flow.startImport(stranger, editor.workspaceId, upload())).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(extraction.jobs).toHaveLength(0);
    });

    it('refuses every editor command to a member, and leaves the script as it was', async () => {
      const { flow, extraction, sourceFiles } = createFlow();
      const editor = await createActor();
      const member = await createMemberOf(editor);
      const { script } = await flow.startImport(editor, editor.workspaceId, upload());
      await flow.onExtractionCompleted(lastRun(extraction), extractionOf(PLAY));
      const before = await scriptRow(script.id);
      const [characterRow] = await db()
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.scriptId, script.id));

      const commands = [
        () => flow.reparse(member, script.id),
        () => flow.previewReparse(member, script.id),
        () => flow.delete(member, script.id),
        () => flow.previewDelete(member, script.id),
        () => flow.confirmGender(member, script.id, characterRow?.id ?? '', 'female'),
      ];
      for (const command of commands) {
        await expect(command()).rejects.toBeInstanceOf(ForbiddenError);
      }

      expect(await scriptRow(script.id)).toEqual(before);
      expect(sourceFiles.remove).not.toHaveBeenCalled();
    });

    it('follows the editor role when it is transferred', async () => {
      const { flow } = createFlow();
      const editor = await createActor();
      const member = await createMemberOf(editor);
      const { script } = await flow.startImport(editor, editor.workspaceId, upload());

      await db().transaction(async (tx) => {
        await tx
          .update(workspaceMembers)
          .set({ role: 'member' })
          .where(eq(workspaceMembers.userId, editor.userId));
        await tx
          .update(workspaceMembers)
          .set({ role: 'editor' })
          .where(eq(workspaceMembers.userId, member.userId));
      });

      await expect(flow.reparse(editor, script.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(flow.reparse(member, script.id)).resolves.toMatchObject({
        kind: 'stage_changed',
      });
    });
  });

  describe('delete', () => {
    it('removes the row and the stored PDF from any stage', async () => {
      const { flow, sourceFiles } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(
        actor,
        actor.workspaceId,
        upload('/uploads/to-delete.pdf'),
      );

      await flow.delete(actor, script.id);

      expect(await scriptRow(script.id)).toBeUndefined();
      expect(sourceFiles.remove).toHaveBeenCalledWith('/uploads/to-delete.pdf');
    });

    it('summarises what would be lost before the editor confirms', async () => {
      const { flow, extraction } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      await flow.onExtractionCompleted(lastRun(extraction), extractionOf(PLAY));

      await expect(flow.previewDelete(actor, script.id)).resolves.toEqual({
        sceneCount: 1,
        lineCount: 3,
        characterCount: 2,
        editedLineCount: 0,
        synthesizedCharacterCount: 0,
      });
    });
  });

  describe('recoverStuckExtractions', () => {
    it('re-queues a run whose job was lost, once', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();
      await flow.startImport(actor, actor.workspaceId, upload());
      extraction.lose();

      clock.advance(GRACE_MS + 1);
      await expect(flow.recoverStuckExtractions({ graceMs: GRACE_MS })).resolves.toEqual({
        checked: 1,
        requeued: 1,
        failed: 0,
      });

      // The re-queued job is still pending: the next sweep leaves it alone.
      await expect(flow.recoverStuckExtractions({ graceMs: GRACE_MS })).resolves.toEqual({
        checked: 1,
        requeued: 0,
        failed: 0,
      });
    });

    it('leaves runs younger than the grace period alone', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();
      await flow.startImport(actor, actor.workspaceId, upload());
      extraction.lose();

      clock.advance(GRACE_MS - 1);
      await expect(flow.recoverStuckExtractions({ graceMs: GRACE_MS })).resolves.toEqual({
        checked: 0,
        requeued: 0,
        failed: 0,
      });
    });

    it('fails a run whose job failed without telling the flow', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();
      const { script } = await flow.startImport(actor, actor.workspaceId, upload());
      extraction.failRun(lastRun(extraction), 'job stalled more than allowable limit');

      clock.advance(GRACE_MS + 1);
      await expect(flow.recoverStuckExtractions({ graceMs: GRACE_MS })).resolves.toEqual({
        checked: 1,
        requeued: 0,
        failed: 1,
      });

      const row = await scriptRow(script.id);
      expect(row?.stage).toBe('failed');
      expect(row?.parseError).toBe('job stalled more than allowable limit');
    });

    it('fails a stuck script that has no PDF to extract', async () => {
      const { flow, clock } = createFlow();
      const actor = await createActor();
      const [row] = await db()
        .insert(scripts)
        .values({
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          title: 'Migrated',
          stage: 'extracting',
          stageEnteredAt: clock.now(),
        })
        .returning();

      clock.advance(GRACE_MS + 1);
      const report = await flow.recoverStuckExtractions({ graceMs: GRACE_MS });

      expect(report.failed).toBe(1);
      expect((await scriptRow(row?.id ?? ''))?.stage).toBe('failed');
    });

    it('ignores scripts that are not extracting', async () => {
      const { flow, extraction, clock } = createFlow();
      const actor = await createActor();
      await flow.startImport(actor, actor.workspaceId, upload());
      await flow.onExtractionCompleted(lastRun(extraction), extractionOf(PLAY));
      extraction.lose();

      clock.advance(GRACE_MS + 1);
      const report = await flow.recoverStuckExtractions({ graceMs: GRACE_MS });

      expect(report.checked).toBe(0);
    });
  });
});
