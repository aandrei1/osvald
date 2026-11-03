import type { Character, Line, SceneWithLines } from '@osvald/shared';
import { describe, expect, it } from 'vitest';

import { buildCharacterNames, countLinesByCharacter } from './script';

const ISO = '2026-10-18T12:00:00.000Z';

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'line-1',
    sceneId: 'scene-1',
    characterId: null,
    orderIndex: 0,
    type: 'dialogue',
    speakerLabel: null,
    text: 'x',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function scene(id: string, lines: Line[]): SceneWithLines {
  return {
    id,
    scriptId: 'script-1',
    orderIndex: 0,
    number: '1',
    title: 'Scena 1',
    synopsis: null,
    pageStart: null,
    pageEnd: null,
    createdAt: ISO,
    updatedAt: ISO,
    lines,
  };
}

function character(id: string, name: string): Character {
  return {
    id,
    scriptId: 'script-1',
    name,
    description: null,
    aliases: [],
    gender: 'unknown',
    genderSource: 'auto',
    createdAt: ISO,
    updatedAt: ISO,
  };
}

describe('buildCharacterNames', () => {
  it('maps ids to display names', () => {
    expect(buildCharacterNames([character('a', 'Harpagon'), character('b', 'Élise')])).toEqual({
      a: 'Harpagon',
      b: 'Élise',
    });
  });

  it('handles an empty cast', () => {
    expect(buildCharacterNames([])).toEqual({});
  });
});

describe('countLinesByCharacter', () => {
  it('counts lines across scenes and ignores directions', () => {
    const scenes = [
      scene('s1', [
        line({ characterId: 'a' }),
        line({ characterId: 'a' }),
        line({ characterId: null, type: 'direction' }),
      ]),
      scene('s2', [line({ characterId: 'b' })]),
    ];

    expect(countLinesByCharacter(scenes)).toEqual({ a: 2, b: 1 });
  });

  it('handles an empty script', () => {
    expect(countLinesByCharacter([])).toEqual({});
  });
});
