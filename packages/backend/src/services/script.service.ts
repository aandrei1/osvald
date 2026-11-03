import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type {
  Character,
  Gender,
  Line,
  SceneWithLines,
  Script,
  ScriptDetail,
  ScriptListResponse,
} from '@osvald/shared';

import type { ParsedScript } from '../parsing/script-parser.js';
import type { Database, Executor } from '../db/client.js';
import { toIsoDateTime } from '../db/mappers.js';
import { characters, type CharacterRow, type NewCharacterRow } from '../db/schema/characters.js';
import { lines, type LineRow, type NewLineRow } from '../db/schema/lines.js';
import { scenes, type NewSceneRow, type SceneRow } from '../db/schema/scenes.js';
import { scripts, type NewScriptRow, type ScriptRow } from '../db/schema/scripts.js';
import { workspaceMembers } from '../db/schema/workspaces.js';
import { authorizeWorkspace } from '../flows/authorization.js';
import { NotFoundError } from '../lib/errors.js';

/* -------------------------------------------------------------------------- */
/* Row → DTO mapping                                                          */
/* (timestamps become ISO strings, nullability is made explicit)               */
/* -------------------------------------------------------------------------- */

export function mapScriptRow(row: ScriptRow): Script {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    title: row.title,
    author: row.author,
    description: row.description,
    stage: row.stage,
    stageEnteredAt: toIsoDateTime(row.stageEnteredAt),
    sourceFileName: row.sourceFileName,
    pageCount: row.pageCount,
    parseError: row.parseError,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

export function mapLineRow(row: LineRow): Line {
  return {
    id: row.id,
    sceneId: row.sceneId,
    characterId: row.characterId,
    orderIndex: row.orderIndex,
    type: row.type,
    speakerLabel: row.speakerLabel,
    text: row.text,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

export function mapSceneRowWithLines(row: SceneRow & { lines: LineRow[] }): SceneWithLines {
  return {
    id: row.id,
    scriptId: row.scriptId,
    orderIndex: row.orderIndex,
    number: row.number,
    title: row.title,
    synopsis: row.synopsis,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
    lines: row.lines.map(mapLineRow),
  };
}

export function mapCharacterRow(row: CharacterRow): Character {
  return {
    id: row.id,
    scriptId: row.scriptId,
    name: row.name,
    description: row.description,
    aliases: row.aliases,
    gender: row.gender,
    genderSource: row.genderSource,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export interface ListScriptsOptions {
  limit: number;
  offset: number;
  workspaceId: string;
  /** Reader; must be a member of the workspace. */
  userId: string;
}

/** Scripts in any workspace the user belongs to. */
function visibleTo(db: Database, userId: string): SQL {
  return inArray(
    scripts.workspaceId,
    db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId)),
  );
}

/** One workspace's library, newest first. A non-member gets a 404. */
export async function listScripts(
  db: Database,
  options: ListScriptsOptions,
): Promise<ScriptListResponse> {
  await authorizeWorkspace(db, { userId: options.userId }, options.workspaceId, 'script:read');
  const where = eq(scripts.workspaceId, options.workspaceId);

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(scripts)
      .where(where)
      .orderBy(desc(scripts.createdAt))
      .limit(options.limit)
      .offset(options.offset),
    db.$count(scripts, where),
  ]);

  return { items: rows.map(mapScriptRow), total };
}

/** Script + nested scenes/lines/characters, via Drizzle's relational query API. */
export async function getScriptDetail(
  db: Database,
  scriptId: string,
  userId: string,
): Promise<ScriptDetail> {
  const row = await db.query.scripts.findFirst({
    where: and(eq(scripts.id, scriptId), visibleTo(db, userId)),
    with: {
      scenes: {
        orderBy: (scene, { asc }) => [asc(scene.orderIndex)],
        with: {
          lines: {
            orderBy: (line, { asc }) => [asc(line.orderIndex)],
          },
        },
      },
      characters: {
        orderBy: (character, { asc }) => [asc(character.name)],
      },
    },
  });

  if (row === undefined) {
    // Deliberately the same answer as "does not exist": a 403 would confirm
    // that a script id outside the caller's workspaces is real.
    throw new NotFoundError('Script', scriptId);
  }

  return {
    ...mapScriptRow(row),
    scenes: row.scenes.map(mapSceneRowWithLines),
    characters: row.characters.map(mapCharacterRow),
  };
}

/** A new script row. Its stage and run come from `ScriptProductionFlow` (or the seed). */
export type InsertScriptInput = Pick<
  NewScriptRow,
  | 'workspaceId'
  | 'userId'
  | 'title'
  | 'author'
  | 'description'
  | 'sourceFileName'
  | 'sourceFilePath'
  | 'pageCount'
  | 'stage'
  | 'stageEnteredAt'
  | 'runId'
>;

export async function insertScript(
  executor: Executor,
  input: InsertScriptInput,
): Promise<ScriptRow> {
  const [row] = await executor.insert(scripts).values(input).returning();

  if (row === undefined) {
    throw new Error('Insert into "scripts" returned no row');
  }

  return row;
}

/* -------------------------------------------------------------------------- */
/* Parse result import                                                        */
/* -------------------------------------------------------------------------- */

export interface SaveParseResultSummary {
  sceneCount: number;
  characterCount: number;
  lineCount: number;
}

/** Postgres rejects very large multi-row inserts; chunk the line bulk insert. */
const INSERT_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * Replaces a script's scenes, characters and lines with a parse result.
 *
 * Runs on the caller's transaction, so the stage change and the lines land
 * together (see `ScriptProductionFlow.onExtractionCompleted`): a script is never
 * left half-parsed. The delete at the top makes it idempotent (lines go with
 * their scenes via `ON DELETE CASCADE`).
 *
 * A gender the actor set by hand is carried over by character name; every
 * other gender comes from `genderByName`, the classifier's fresh guess.
 */
export async function saveParseResult(
  tx: Executor,
  scriptId: string,
  parsed: ParsedScript,
  options: { genderByName?: ReadonlyMap<string, Gender> } = {},
): Promise<SaveParseResultSummary> {
  const manualGenders = await tx
    .select({ name: characters.name, gender: characters.gender })
    .from(characters)
    .where(and(eq(characters.scriptId, scriptId), eq(characters.genderSource, 'manual')));
  const manualGenderByName = new Map(manualGenders.map((row) => [row.name, row.gender]));

  await tx.delete(scenes).where(eq(scenes.scriptId, scriptId));
  await tx.delete(characters).where(eq(characters.scriptId, scriptId));

  const characterIdsByName = new Map<string, string>();

  if (parsed.characters.length > 0) {
    const characterValues: NewCharacterRow[] = parsed.characters.map((character) => {
      const manual = manualGenderByName.get(character.name);

      return {
        scriptId,
        name: character.name,
        description: character.description,
        aliases: character.aliases,
        gender: manual ?? options.genderByName?.get(character.name) ?? 'unknown',
        genderSource: manual === undefined ? 'auto' : 'manual',
      };
    });

    const insertedCharacters = await tx
      .insert(characters)
      .values(characterValues)
      .returning({ id: characters.id, name: characters.name });

    for (const inserted of insertedCharacters) {
      characterIdsByName.set(inserted.name, inserted.id);
    }
  }

  const sceneValues: NewSceneRow[] = parsed.scenes.map((scene, orderIndex) => ({
    scriptId,
    orderIndex,
    number: scene.number.slice(0, 64),
    title: scene.title.slice(0, 300),
    synopsis: null,
    pageStart: scene.pageStart,
    pageEnd: scene.pageEnd,
  }));

  let lineCount = 0;

  if (sceneValues.length > 0) {
    const insertedScenes = await tx
      .insert(scenes)
      .values(sceneValues)
      .returning({ id: scenes.id, orderIndex: scenes.orderIndex });

    const sceneIdsByOrder = new Map(insertedScenes.map((scene) => [scene.orderIndex, scene.id]));

    const lineValues: NewLineRow[] = [];

    for (const [sceneIndex, scene] of parsed.scenes.entries()) {
      const sceneId = sceneIdsByOrder.get(sceneIndex);
      if (sceneId === undefined) {
        continue;
      }

      for (const [orderIndex, line] of scene.lines.entries()) {
        lineValues.push({
          sceneId,
          characterId:
            line.characterName === null
              ? null
              : (characterIdsByName.get(line.characterName) ?? null),
          orderIndex,
          type: line.type,
          speakerLabel: line.speakerLabel,
          text: line.text,
        });
      }
    }

    for (const batch of chunk(lineValues, INSERT_CHUNK_SIZE)) {
      await tx.insert(lines).values(batch);
    }

    lineCount = lineValues.length;
  }

  return {
    sceneCount: sceneValues.length,
    characterCount: parsed.characters.length,
    lineCount,
  };
}

/** Sets a role's gender by hand; `manual` keeps it through every reparse. */
export async function setCharacterGender(
  db: Database,
  scriptId: string,
  characterId: string,
  gender: Gender,
): Promise<Character> {
  const [row] = await db
    .update(characters)
    .set({ gender, genderSource: 'manual', updatedAt: new Date() })
    .where(and(eq(characters.id, characterId), eq(characters.scriptId, scriptId)))
    .returning();

  if (row === undefined) {
    throw new NotFoundError('Character', characterId);
  }

  return mapCharacterRow(row);
}

/*
 * TODO(scripts): updateScript (title/author metadata).
 */
