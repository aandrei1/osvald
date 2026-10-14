import { and, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import type {
  Character,
  Line,
  SceneWithLines,
  Script,
  ScriptDetail,
  ScriptListResponse,
  ScriptStatus,
} from '@osvald/shared';

import type { ParsedScript } from '../parsing/script-parser.js';
import type { Database } from '../db/client.js';
import { toIsoDateTime } from '../db/mappers.js';
import { characters, type CharacterRow, type NewCharacterRow } from '../db/schema/characters.js';
import { lines, type LineRow, type NewLineRow } from '../db/schema/lines.js';
import { scenes, type NewSceneRow, type SceneRow } from '../db/schema/scenes.js';
import { scripts, type NewScriptRow, type ScriptRow } from '../db/schema/scripts.js';
import { NotFoundError } from '../lib/errors.js';

/* -------------------------------------------------------------------------- */
/* Row → DTO mapping                                                          */
/* (timestamps become ISO strings, nullability is made explicit)               */
/* -------------------------------------------------------------------------- */

export function mapScriptRow(row: ScriptRow): Script {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    author: row.author,
    description: row.description,
    status: row.status,
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
  /** Owner whose library is being read. */
  userId: string;
}

/**
 * Scripts visible to one user, newest first.
 *
 * Anonymous scripts (`user_id IS NULL`) stay visible to everyone: uploads made
 * before the uploader signed in would otherwise disappear from their library.
 */
function visibleTo(userId: string): SQL | undefined {
  return or(eq(scripts.userId, userId), isNull(scripts.userId));
}

export async function listScripts(
  db: Database,
  options: ListScriptsOptions,
): Promise<ScriptListResponse> {
  const where = visibleTo(options.userId);

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
    where: and(eq(scripts.id, scriptId), visibleTo(userId)),
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
    // that someone else's script id is real.
    throw new NotFoundError('Script', scriptId);
  }

  return {
    ...mapScriptRow(row),
    scenes: row.scenes.map(mapSceneRowWithLines),
    characters: row.characters.map(mapCharacterRow),
  };
}

/** Loads a script row for ownership checks, without its scenes. */
export async function getScriptRow(
  db: Database,
  scriptId: string,
  userId: string,
): Promise<ScriptRow> {
  const row = await db.query.scripts.findFirst({
    where: and(eq(scripts.id, scriptId), visibleTo(userId)),
  });

  if (row === undefined) {
    throw new NotFoundError('Script', scriptId);
  }

  return row;
}

export interface CreateUploadedScriptInput {
  userId: string | null;
  title: string;
  author: string | null;
  description: string | null;
  sourceFileName: string;
  /** `null` for scripts imported from already-extracted text (the seed). */
  sourceFilePath: string | null;
}

export async function createUploadedScript(
  db: Database,
  input: CreateUploadedScriptInput,
): Promise<Script> {
  const values: NewScriptRow = {
    userId: input.userId,
    title: input.title,
    author: input.author,
    description: input.description,
    sourceFileName: input.sourceFileName,
    sourceFilePath: input.sourceFilePath,
    status: 'uploaded',
  };

  const [row] = await db.insert(scripts).values(values).returning();

  if (row === undefined) {
    throw new Error('Insert into "scripts" returned no row');
  }

  return mapScriptRow(row);
}

/** Status transitions are driven by the script-parsing worker (`src/queue`). */
export async function updateScriptStatus(
  db: Database,
  scriptId: string,
  status: ScriptStatus,
  parseError: string | null = null,
): Promise<void> {
  await db
    .update(scripts)
    .set({ status, parseError, updatedAt: new Date() })
    .where(eq(scripts.id, scriptId));
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
 * Everything happens in one transaction, so a script is never left half-parsed:
 * either the whole play lands and the status becomes `parsed`, or nothing
 * changes. Re-parsing is therefore safe to run repeatedly — the delete at the
 * top makes it idempotent (lines and characters go with their scenes/script via
 * `ON DELETE CASCADE`).
 */
export async function saveParseResult(
  db: Database,
  scriptId: string,
  parsed: ParsedScript,
  options: { title?: string; author?: string | null } = {},
): Promise<SaveParseResultSummary> {
  return db.transaction(async (tx) => {
    await tx.delete(scenes).where(eq(scenes.scriptId, scriptId));
    await tx.delete(characters).where(eq(characters.scriptId, scriptId));

    const characterIdsByName = new Map<string, string>();

    if (parsed.characters.length > 0) {
      const characterValues: NewCharacterRow[] = parsed.characters.map((character) => ({
        scriptId,
        name: character.name,
        description: character.description,
        aliases: character.aliases,
      }));

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

    await tx
      .update(scripts)
      .set({
        status: 'parsed',
        parseError: null,
        pageCount: parsed.stats.pageCount > 0 ? parsed.stats.pageCount : null,
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.author !== undefined ? { author: options.author } : {}),
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId));

    return {
      sceneCount: sceneValues.length,
      characterCount: parsed.characters.length,
      lineCount,
    };
  });
}

/** Removes a script and everything that hangs off it. */
export async function deleteScript(db: Database, scriptId: string): Promise<void> {
  await db.delete(scripts).where(eq(scripts.id, scriptId));
}

/*
 * TODO(scripts): updateScript (title/author metadata) and a sweep that removes
 * the stored upload file when a script row is deleted.
 */
