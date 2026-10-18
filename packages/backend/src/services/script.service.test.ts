import { describe, expect, it } from 'vitest';

import type { CharacterRow } from '../db/schema/characters.js';
import type { LineRow } from '../db/schema/lines.js';
import type { SceneRow } from '../db/schema/scenes.js';
import type { ScriptRow } from '../db/schema/scripts.js';
import {
  mapCharacterRow,
  mapLineRow,
  mapSceneRowWithLines,
  mapScriptRow,
} from './script.service.js';

/**
 * Row → DTO mapping is the seam between the database representation and the
 * shared wire contract: timestamps become ISO strings, nullable columns stay
 * explicit, and internal fields (`sourceFilePath`) never leave the server.
 */

const createdAt = new Date('2026-10-18T12:00:00.000Z');
const updatedAt = new Date('2026-10-18T13:00:00.000Z');

const scriptId = '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6b';
const sceneId = '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6c';
const characterId = '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6d';
const userId = '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6e';

const scriptRow: ScriptRow = {
  id: scriptId,
  userId,
  title: 'Avarul',
  author: 'Molière',
  description: null,
  status: 'parsed',
  sourceFileName: 'avarul.pdf',
  sourceFilePath: '/tmp/avarul.pdf',
  pageCount: 286,
  parseError: null,
  createdAt,
  updatedAt,
};

const lineRow: LineRow = {
  id: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6f',
  sceneId,
  characterId: null,
  orderIndex: 2,
  type: 'direction',
  speakerLabel: null,
  text: '(Valère intră.)',
  createdAt,
  updatedAt,
};

const sceneRow: SceneRow = {
  id: sceneId,
  scriptId,
  orderIndex: 0,
  number: 'Actul 1 · Scena 1',
  title: 'Valère, Élise',
  synopsis: null,
  pageStart: 1,
  pageEnd: 2,
  createdAt,
  updatedAt,
};

const characterRow: CharacterRow = {
  id: characterId,
  scriptId,
  name: 'Harpagon',
  description: 'tatăl lui Cléante și al Élisei.',
  aliases: ['HARPAGON'],
  createdAt,
  updatedAt,
};

describe('mapScriptRow', () => {
  it('converts timestamps and hides the stored file path', () => {
    const mapped = mapScriptRow(scriptRow);

    expect(mapped).toEqual({
      id: scriptId,
      userId,
      title: 'Avarul',
      author: 'Molière',
      description: null,
      status: 'parsed',
      sourceFileName: 'avarul.pdf',
      pageCount: 286,
      parseError: null,
      createdAt: '2026-10-18T12:00:00.000Z',
      updatedAt: '2026-10-18T13:00:00.000Z',
    });
    expect(mapped).not.toHaveProperty('sourceFilePath');
  });
});

describe('mapLineRow', () => {
  it('keeps the line type and nullability', () => {
    expect(mapLineRow(lineRow)).toEqual({
      id: lineRow.id,
      sceneId,
      characterId: null,
      orderIndex: 2,
      type: 'direction',
      speakerLabel: null,
      text: '(Valère intră.)',
      createdAt: '2026-10-18T12:00:00.000Z',
      updatedAt: '2026-10-18T13:00:00.000Z',
    });
  });
});

describe('mapSceneRowWithLines', () => {
  it('maps the scene and its ordered lines together', () => {
    const mapped = mapSceneRowWithLines({ ...sceneRow, lines: [lineRow] });

    expect(mapped).toMatchObject({
      id: sceneId,
      scriptId,
      orderIndex: 0,
      number: 'Actul 1 · Scena 1',
      title: 'Valère, Élise',
      pageStart: 1,
      pageEnd: 2,
      createdAt: '2026-10-18T12:00:00.000Z',
    });
    expect(mapped.lines).toHaveLength(1);
    expect(mapped.lines[0]?.type).toBe('direction');
  });
});

describe('mapCharacterRow', () => {
  it('maps the cast entry and its aliases', () => {
    expect(mapCharacterRow(characterRow)).toEqual({
      id: characterId,
      scriptId,
      name: 'Harpagon',
      description: 'tatăl lui Cléante și al Élisei.',
      aliases: ['HARPAGON'],
      createdAt: '2026-10-18T12:00:00.000Z',
      updatedAt: '2026-10-18T13:00:00.000Z',
    });
  });
});
