import { describe, expect, it } from 'vitest';

import {
  assignVoices,
  pickVoiceForLanguage,
  speechTagFor,
  voiceSpeaks,
  voicesForLanguage,
  type CastMember,
  type SpeechVoice,
} from './speech';

/**
 * These helpers decide which voice reads which character. Getting them wrong is
 * immediately audible: two roles with the same voice make a rehearsal
 * impossible to follow, and an English voice on Romanian text is noise.
 */

function voice(overrides: Partial<SpeechVoice> & Pick<SpeechVoice, 'id' | 'lang'>): SpeechVoice {
  return {
    name: overrides.id,
    isDefault: false,
    source: 'server',
    gender: 'unknown',
    ...overrides,
  };
}

function cast(...ids: string[]): CastMember[] {
  return ids.map((id) => ({ id, gender: 'unknown' }));
}

const voices: SpeechVoice[] = [
  voice({ id: 'piper:mihai', name: 'Mihai', lang: 'ro-RO' }),
  voice({ id: 'piper:amy', name: 'Amy', lang: 'ro-RO', isDefault: true }),
  voice({ id: 'mms:eng', name: 'English', lang: 'en-US', isDefault: true }),
];

describe('speechTagFor', () => {
  it('returns the BCP-47 tag a speech engine expects', () => {
    expect(speechTagFor('ro')).toBe('ro-RO');
    expect(speechTagFor('en')).toBe('en-US');
  });
});

describe('voiceSpeaks', () => {
  it('matches a language regardless of region or separator spelling', () => {
    expect(voiceSpeaks(voice({ id: 'a', lang: 'ro-RO' }), 'ro')).toBe(true);
    expect(voiceSpeaks(voice({ id: 'a', lang: 'ro_RO' }), 'ro')).toBe(true);
    expect(voiceSpeaks(voice({ id: 'a', lang: 'ro' }), 'ro')).toBe(true);
  });

  it('rejects a different language', () => {
    expect(voiceSpeaks(voice({ id: 'a', lang: 'en-US' }), 'ro')).toBe(false);
  });
});

describe('voicesForLanguage', () => {
  it('filters the catalogue and keeps the reported order', () => {
    expect(voicesForLanguage(voices, 'ro').map((candidate) => candidate.id)).toEqual([
      'piper:mihai',
      'piper:amy',
    ]);
  });

  it('returns nothing when the language has no voice', () => {
    expect(voicesForLanguage(voices, 'en').map((candidate) => candidate.id)).toEqual(['mms:eng']);
    expect(voicesForLanguage([], 'ro')).toEqual([]);
  });
});

describe('pickVoiceForLanguage', () => {
  it('prefers the engine default', () => {
    expect(pickVoiceForLanguage(voices, 'ro')?.id).toBe('piper:amy');
  });

  it('falls back to the first voice when none is marked default', () => {
    const notDefault = [
      voice({ id: 'first', lang: 'ro-RO' }),
      voice({ id: 'second', lang: 'ro-RO' }),
    ];

    expect(pickVoiceForLanguage(notDefault, 'ro')?.id).toBe('first');
  });

  it('returns null when the language has no voice', () => {
    expect(pickVoiceForLanguage(voices, 'en')?.id).toBe('mms:eng');
    expect(pickVoiceForLanguage([], 'ro')).toBeNull();
  });
});

describe('assignVoices', () => {
  it('gives each role a different voice where the engine has enough', () => {
    expect(assignVoices(cast('a', 'b'), voices, 'ro')).toEqual({
      a: 'piper:mihai',
      b: 'piper:amy',
    });
  });

  it('round-robins when there are fewer voices than roles', () => {
    expect(assignVoices(cast('a', 'b', 'c'), voices, 'ro')).toEqual({
      a: 'piper:mihai',
      b: 'piper:amy',
      c: 'piper:mihai',
    });
  });

  it('leaves every character unassigned when the language has no voice', () => {
    // Pinning an English voice would force the wrong phonetics; an unassigned
    // character still gets spoken with the right language tag.
    expect(assignVoices(cast('a', 'b'), voices, 'ro')).not.toEqual({});
    expect(assignVoices(cast('a', 'b'), [voice({ id: 'en', lang: 'en-US' })], 'ro')).toEqual({});
  });

  it('handles an empty cast', () => {
    expect(assignVoices([], voices, 'ro')).toEqual({});
  });

  it('falls back to any voice of the language when none matches the gender', () => {
    // Romanian has no female offline voice yet; a woman still gets read.
    const men = [
      voice({ id: 'piper:mihai', lang: 'ro-RO', gender: 'male' }),
      voice({ id: 'mms:radu', lang: 'ro-RO', gender: 'male' }),
    ];

    expect(assignVoices([{ id: 'veta', gender: 'female' }], men, 'ro')).toEqual({
      veta: 'piper:mihai',
    });
  });

  it('prefers the voice the existing cast uses least', () => {
    expect(assignVoices(cast('b'), voices, 'ro', { a: 'piper:mihai' })).toEqual({
      b: 'piper:amy',
    });
  });
});
