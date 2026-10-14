import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { eq } from 'drizzle-orm';

import { env } from '../config/env.js';
import { createDatabase, type Database } from '../db/client.js';
import { scripts } from '../db/schema/scripts.js';
import { createConsoleLogger } from '../lib/logger.js';
import { parseScriptText, splitIntoWorks } from '../parsing/script-parser.js';
import { createUploadedScript, saveParseResult } from '../services/script.service.js';
import { upsertUser } from '../services/user.service.js';

/**
 * Imports already-extracted script text straight into the database.
 *
 * Why this exists: `codPython/avarul.txt` is the OCR output of a 286-page
 * scanned volume. Re-running that OCR takes many minutes and the source PDF is
 * larger than the upload limit, so the demo library would otherwise be empty
 * until someone waited out a full parse. This skips the extraction step only —
 * the text goes through exactly the same parser and the same persistence path
 * as an upload.
 *
 *   pnpm db:seed
 *   pnpm db:seed -- --file path/to/other.txt --email me@example.com
 */

/** `src/scripts` → repo root. */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const DEFAULT_TEXT_FILE = 'codPython/avarul.txt';
const DEMO_EMAIL = 'demo@osvald.app';
const DEMO_PASSWORD = 'osvald-demo-2026';

interface SeedOptions {
  /** Absolute path of the text file to import. */
  file: string;
  /** How the file was named on the command line, for display. */
  label: string;
  email: string;
  password: string;
  author: string | null;
  reset: boolean;
}

function readOptions(): SeedOptions {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      email: { type: 'string', default: DEMO_EMAIL },
      password: { type: 'string', default: DEMO_PASSWORD },
      author: { type: 'string', default: 'Molière' },
      /** Remove this account's previously seeded scripts first. */
      reset: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  // The default is relative to the repo root, which is where `codPython` lives
  // regardless of the package the command was run from. An explicit `--file` is
  // whatever the caller typed, so it resolves against their working directory.
  const label = values.file ?? DEFAULT_TEXT_FILE;
  const file =
    values.file === undefined ? resolve(REPO_ROOT, DEFAULT_TEXT_FILE) : resolve(values.file);

  return {
    file,
    label,
    email: values.email ?? DEMO_EMAIL,
    password: values.password ?? DEMO_PASSWORD,
    author: values.author === '' ? null : (values.author ?? null),
    reset: values.reset ?? false,
  };
}

/** `avarul.txt` holds three plays; each becomes its own script. */
function titleFor(segment: { title: string | null }, index: number): string {
  return segment.title ?? `Untitled work ${index + 1}`;
}

async function importWorks(db: Database, options: SeedOptions, userId: string): Promise<number> {
  const raw = await readFile(options.file, 'utf8');

  const segments = splitIntoWorks(raw);
  const logger = createConsoleLogger(env.LOG_LEVEL);

  logger.info(`found ${segments.length} work(s) in ${options.file}`);

  let imported = 0;

  for (const [index, segment] of segments.entries()) {
    const title = titleFor(segment, index);
    const parsed = parseScriptText(segment.raw);

    const dialogueCount = parsed.scenes.reduce(
      (total, scene) => total + scene.lines.filter((line) => line.type === 'dialogue').length,
      0,
    );

    if (dialogueCount === 0) {
      logger.warn(`skipping "${title}": no dialogue recognised`);
      continue;
    }

    const script = await createUploadedScript(db, {
      userId,
      title,
      author: options.author,
      description: `Seeded from ${options.label}`,
      sourceFileName: options.label.split('/').pop() ?? options.label,
      // No PDF on disk, so re-parsing from source is not possible. The route
      // rejects a reparse for exactly this case.
      sourceFilePath: null,
    });

    const summary = await saveParseResult(db, script.id, parsed);
    imported += 1;

    logger.info(
      `imported "${title}": ${summary.sceneCount} scene(s), ` +
        `${summary.characterCount} character(s), ${summary.lineCount} line(s)`,
    );
  }

  return imported;
}

async function main(): Promise<void> {
  const options = readOptions();
  const logger = createConsoleLogger(env.LOG_LEVEL);
  const database = createDatabase();

  try {
    const user = await upsertUser(database.db, {
      email: options.email,
      password: options.password,
      displayName: 'Demo actor',
    });

    logger.info(`seeding into account ${user.email} (${user.id})`);

    if (options.reset) {
      const removed = await database.db
        .delete(scripts)
        .where(eq(scripts.userId, user.id))
        .returning({ id: scripts.id });

      logger.info(`removed ${removed.length} existing script(s)`);
    }

    const imported = await importWorks(database.db, options, user.id);

    logger.info(`done — ${imported} script(s) ready to rehearse`);
    logger.info(`sign in with ${options.email} / ${options.password}`);
  } finally {
    await database.close();
  }
}

await main();
