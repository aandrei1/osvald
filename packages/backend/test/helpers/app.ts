import { randomUUID } from 'node:crypto';

import { hash } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

import { buildApp } from '../../src/app.js';
import type { Database } from '../../src/db/client.js';
import { characters } from '../../src/db/schema/characters.js';
import { lines } from '../../src/db/schema/lines.js';
import { scenes } from '../../src/db/schema/scenes.js';
import { scripts } from '../../src/db/schema/scripts.js';
import { users } from '../../src/db/schema/users.js';
import type { QueueRegistry } from '../../src/queue/queues.js';
import { createFakeQueues, createFakeRedis, type FakeQueues } from './fakes.js';

/**
 * Builds the real Fastify app around a test database and fake infrastructure.
 * Route tests therefore exercise the actual plugins, Zod compilers, auth guard
 * and error handler — only Postgres is real, because the queries are the point.
 */

export interface TestApp {
  app: FastifyInstance;
  queues: FakeQueues;
  close(): Promise<void>;
}

export async function createTestApp(
  db: Database,
  options: { redis?: Redis; queues?: QueueRegistry } = {},
): Promise<TestApp> {
  const queues = createFakeQueues();

  const app = await buildApp({
    db,
    redis: options.redis ?? createFakeRedis(),
    queues: options.queues ?? queues.registry,
  });

  await app.ready();

  return {
    app,
    queues,
    async close(): Promise<void> {
      await app.close();
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
}

/** Inserts an account directly and signs the token the route guard expects. */
export async function createTestUser(
  app: FastifyInstance,
  db: Database,
  options: { email?: string; password?: string } = {},
): Promise<TestUser> {
  const email = (options.email ?? `actor-${randomUUID()}@example.com`).toLowerCase();
  const password = options.password ?? 'correct horse battery staple';

  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await hash(password), displayName: 'Test Actor' })
    .returning();

  if (row === undefined) {
    throw new Error('inserting a test user returned no row');
  }

  return { id: row.id, email, password, token: app.jwt.sign({ sub: row.id, email }) };
}

export interface SeededScript {
  scriptId: string;
  sceneId: string;
  characterId: string;
}

/** One parsed script with a scene, a character and a dialogue + direction line. */
export async function seedParsedScript(
  db: Database,
  options: { userId: string | null; title?: string; sourceFilePath?: string | null },
): Promise<SeededScript> {
  const [script] = await db
    .insert(scripts)
    .values({
      userId: options.userId,
      title: options.title ?? 'Avarul',
      author: 'Molière',
      status: 'parsed',
      sourceFileName: 'avarul.pdf',
      sourceFilePath: options.sourceFilePath ?? null,
      pageCount: 2,
    })
    .returning();

  if (script === undefined) {
    throw new Error('inserting a test script returned no row');
  }

  const [character] = await db
    .insert(characters)
    .values({
      scriptId: script.id,
      name: 'Harpagon',
      description: 'tatăl lui Cléante și al Élisei.',
      aliases: ['HARPAGON'],
    })
    .returning();

  if (character === undefined) {
    throw new Error('inserting a test character returned no row');
  }

  const [scene] = await db
    .insert(scenes)
    .values({
      scriptId: script.id,
      orderIndex: 0,
      number: 'Actul 1 · Scena 1',
      title: 'Valère, Élise',
      pageStart: 1,
      pageEnd: 1,
    })
    .returning();

  if (scene === undefined) {
    throw new Error('inserting a test scene returned no row');
  }

  await db.insert(lines).values([
    {
      sceneId: scene.id,
      characterId: character.id,
      orderIndex: 0,
      type: 'dialogue',
      speakerLabel: 'HARPAGON',
      text: 'Nimic, tată.',
    },
    {
      sceneId: scene.id,
      characterId: null,
      orderIndex: 1,
      type: 'direction',
      speakerLabel: null,
      text: '(Valère intră.)',
    },
  ]);

  return { scriptId: script.id, sceneId: scene.id, characterId: character.id };
}

export interface MultipartPayload {
  payload: Buffer;
  headers: Record<string, string>;
}

/** A one-file `multipart/form-data` body, as `@fastify/multipart` expects it. */
export function multipartFile(
  fileName: string,
  contentType: string,
  content: Buffer,
): MultipartPayload {
  const boundary = `----osvald-test-${randomUUID()}`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    payload: Buffer.concat([header, content, footer]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** `Authorization` header for a signed token. */
export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
