import type { Character, Line, SceneWithLines } from '@osvald/shared';
import { describe, expect, it } from 'vitest';

import type { SpeechVoice } from './speech';
import {
  assignVoicesForNewCharacters,
  detectScriptLanguage,
  LANGUAGE_SAMPLE_LINES,
  languageOf,
  voiceForLine,
} from './voice-casting';

/**
 * These rules decide which voice reads which character. Getting them wrong is
 * immediately audible: two roles with the same voice make a rehearsal
 * impossible to follow, and an English voice on Romanian text is noise.
 */

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

function scene(lines: Line[]): SceneWithLines {
  return {
    id: 'scene-1',
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

function character(id: string): Character {
  return {
    id,
    scriptId: 'script-1',
    name: id,
    description: null,
    aliases: [],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function voice(id: string, lang: string, isDefault = false): SpeechVoice {
  return { id, name: id, lang, isDefault, source: 'server' };
}

describe('detectScriptLanguage', () => {
  it('detects Romanian', () => {
    expect(detectScriptLanguage([scene([line({ text: 'Nu știu ce să fac.' })])])).toBe('ro');
  });

  it('detects English', () => {
    expect(detectScriptLanguage([scene([line({ text: 'I do not know what to do.' })])])).toBe('en');
  });

  it('falls back to English for an empty script', () => {
    expect(detectScriptLanguage([])).toBe('en');
  });

  it('only samples the first lines of the script', () => {
    const english = Array.from({ length: LANGUAGE_SAMPLE_LINES }, (_, index) =>
      line({ id: `en-${index}`, text: 'the and you are' }),
    );
    const romanianTail = Array.from({ length: 200 }, (_, index) =>
      line({ id: `ro-${index}`, text: 'nu ce sa dar' }),
    );

    // Without the cap the much larger Romanian tail would win.
    expect(detectScriptLanguage([scene([...english, ...romanianTail])])).toBe('en');
  });
});

describe('languageOf', () => {
  it('detects the language of a line', () => {
    expect(languageOf(line({ text: 'Nu știu ce să fac.' }), 'en')).toBe('ro');
  });

  it('uses the script language when the line is too short to call', () => {
    expect(languageOf(line({ text: 'Da.' }), 'ro')).toBe('ro');
  });

  it('can switch language for a quoted line', () => {
    expect(languageOf(line({ text: 'I do not know what to do.' }), 'ro')).toBe('en');
  });
});

describe('voiceForLine', () => {
  const voices = [
    voice('ro:mihai', 'ro-RO'),
    voice('ro:amy', 'ro-RO', true),
    voice('en:one', 'en-US', true),
  ];

  const context = {
    scriptLanguage: 'ro' as const,
    voices,
    voiceByCharacterId: { harpagon: 'ro:mihai' },
  };

  it('uses the voice assigned to the character', () => {
    const result = voiceForLine(
      line({ characterId: 'harpagon', text: 'Nu știu ce să fac.' }),
      context,
    );

    expect(result).toEqual({ voiceId: 'ro:mihai', lang: 'ro-RO' });
  });

  it('picks the default voice when the character has none', () => {
    const result = voiceForLine(line({ characterId: 'elise', text: 'Nu știu.' }), context);

    expect(result).toEqual({ voiceId: 'ro:amy', lang: 'ro-RO' });
  });

  it('ignores a character voice when the line is in another language', () => {
    const result = voiceForLine(
      line({ characterId: 'harpagon', text: 'I do not know what to do.' }),
      context,
    );

    expect(result).toEqual({ voiceId: 'en:one', lang: 'en-US' });
  });

  it('tags a direction with the script language', () => {
    const result = voiceForLine(
      line({ characterId: null, type: 'direction', text: 'Nu știu.' }),
      context,
    );

    expect(result).toEqual({ voiceId: 'ro:amy', lang: 'ro-RO' });
  });

  it('reports no voice when the language has none', () => {
    const result = voiceForLine(line({ text: 'Nu știu.' }), {
      ...context,
      voices: [voice('en:one', 'en-US')],
    });

    expect(result).toEqual({ voiceId: null, lang: 'ro-RO' });
  });
});

describe('assignVoicesForNewCharacters', () => {
  const voices = [voice('ro:mihai', 'ro-RO'), voice('ro:amy', 'ro-RO')];

  it('assigns only the characters that have no voice', () => {
    const result = assignVoicesForNewCharacters(
      [character('a'), character('b'), character('c')],
      voices,
      'ro',
      { a: 'ro:amy' },
    );

    expect(result).toEqual({ b: 'ro:mihai', c: 'ro:amy' });
  });

  it('returns nothing when every character already has a voice', () => {
    expect(assignVoicesForNewCharacters([character('a')], voices, 'ro', { a: 'ro:mihai' })).toEqual(
      {},
    );
  });

  it('returns nothing when there is no voice for the language', () => {
    expect(
      assignVoicesForNewCharacters([character('a')], [voice('en:one', 'en-US')], 'ro', {}),
    ).toEqual({});
  });

  it('handles an empty cast', () => {
    expect(assignVoicesForNewCharacters([], voices, 'ro', {})).toEqual({});
  });
});
