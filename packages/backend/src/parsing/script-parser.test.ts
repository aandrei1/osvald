import { describe, expect, it } from 'vitest';

import { characterKey, parseScriptText, splitIntoWorks, toDisplayName } from './script-parser.js';

/**
 * The parser is the heart of the product: it turns an OCR'd play into the
 * scenes, characters and lines the rehearsal engine walks. It is heuristic by
 * design, so these tests pin the printed conventions it promises to understand.
 */

const PLAY = `=== PAGINA 1 ===
PERSONAJELE
HARPAGON, tatăl lui Cléante și al Élisei.
CLÉANTE, fiul lui Harpagon.
ÉLISE, fiica lui Harpagon.
VALÈRE, intendentul lui Harpagon.
Acțiunea se desfășoară la Paris.

ACTUL 1
SCENA 1
Valère, Élise

HARPAGON: Nimic, tată.
CLÉANTE: Ce spui?
(Valère intră.)
VALÈRE: Domnule, am venit.

=== PAGINA 2 ===
ACTUL 1
SCENA 2

HARPAGON: Unde ești?
(Élise plânge
și nu răspunde.)
ÉLISE: Aici, tată.
`;

describe('characterKey', () => {
  it('folds case, diacritics and punctuation', () => {
    expect(characterKey('Harpagon')).toBe('HARPAGON');
    expect(characterKey('Șganarel')).toBe('SGANAREL');
    expect(characterKey('Élise')).toBe('ELISE');
    expect(characterKey('La Flèche')).toBe('LAFLECHE');
    expect(characterKey('1st Gravedigger')).toBe('1STGRAVEDIGGER');
  });
});

describe('toDisplayName', () => {
  it('turns an all-caps printed label into a name', () => {
    expect(toDisplayName('HARPAGON')).toBe('Harpagon');
    expect(toDisplayName('JUPÂNUL JACQUES')).toBe('Jupânul Jacques');
    expect(toDisplayName('LA FLÈCHE')).toBe('La Flèche');
  });

  it('leaves an already mixed-case name alone', () => {
    expect(toDisplayName('Valère')).toBe('Valère');
  });

  it('strips trailing punctuation left by a cast list', () => {
    expect(toDisplayName('HARPAGON, ')).toBe('Harpagon');
  });
});

describe('parseScriptText', () => {
  it('reads a printed scene into scenes, characters and typed lines', () => {
    const parsed = parseScriptText(PLAY);

    expect(parsed.scenes).toHaveLength(2);

    const [first, second] = parsed.scenes;
    expect(first?.number).toBe('Actul 1 · Scena 1');
    expect(first?.title).toBe('Valère, Élise');
    expect(first?.pageStart).toBe(1);
    expect(first?.pageEnd).toBe(1);
    expect(first?.lines).toEqual([
      {
        type: 'dialogue',
        speakerLabel: 'HARPAGON',
        characterName: 'Harpagon',
        text: 'Nimic, tată.',
      },
      {
        type: 'dialogue',
        speakerLabel: 'CLÉANTE',
        characterName: 'Cléante',
        text: 'Ce spui?',
      },
      {
        type: 'direction',
        speakerLabel: null,
        characterName: null,
        text: '(Valère intră.)',
      },
      {
        type: 'dialogue',
        speakerLabel: 'VALÈRE',
        characterName: 'Valère',
        text: 'Domnule, am venit.',
      },
    ]);

    expect(second?.number).toBe('Actul 1 · Scena 2');
    expect(second?.pageStart).toBe(2);
    expect(second?.lines.map((line) => line.type)).toEqual(['dialogue', 'direction', 'dialogue']);
  });

  it('keeps the cast list notes and maps printed labels to canonical names', () => {
    const parsed = parseScriptText(PLAY);

    expect(parsed.characters).toEqual([
      { name: 'Cléante', description: 'fiul lui Harpagon.', aliases: ['CLÉANTE'] },
      { name: 'Élise', description: 'fiica lui Harpagon.', aliases: ['ÉLISE'] },
      { name: 'Harpagon', description: 'tatăl lui Cléante și al Élisei.', aliases: ['HARPAGON'] },
      { name: 'Valère', description: 'intendentul lui Harpagon.', aliases: ['VALÈRE'] },
    ]);
  });

  it('joins a stage direction that spans several printed lines', () => {
    const parsed = parseScriptText(PLAY);
    const direction = parsed.scenes[1]?.lines[1];

    expect(direction).toEqual({
      type: 'direction',
      speakerLabel: null,
      characterName: null,
      text: '(Élise plânge și nu răspunde.)',
    });
  });

  it('reports the page count and dropped furniture in stats', () => {
    const parsed = parseScriptText(PLAY);

    expect(parsed.stats.pageCount).toBe(2);
    expect(parsed.stats.droppedLines).toBe(0);
    expect(parsed.stats.orphanLines).toBe(0);
  });

  it('keeps unattributed text as a direction instead of dropping it', () => {
    const parsed = parseScriptText(`ACTUL 1
Un text fără vorbitor.
HARPAGON: Bună ziua.
`);

    expect(parsed.stats.orphanLines).toBe(1);
    expect(parsed.scenes[0]?.lines[0]).toEqual({
      type: 'direction',
      speakerLabel: null,
      characterName: null,
      text: 'Un text fără vorbitor.',
    });
  });

  it('rejoins a speaker label whose delivery note wraps', () => {
    const parsed = parseScriptText(`=== PAGINA 1 ===
ACTUL 1
SCENA 1

SGANAREL (ţinând
o tabacheră):
Bună ziua.
`);

    expect(parsed.scenes[0]?.lines).toEqual([
      {
        type: 'direction',
        speakerLabel: null,
        characterName: null,
        text: '(ţinând o tabacheră)',
      },
      {
        type: 'dialogue',
        speakerLabel: 'SGANAREL',
        characterName: 'Sganarel',
        text: 'Bună ziua.',
      },
    ]);
  });

  it('merges an OCR spelling variant into the character that speaks most', () => {
    const parsed = parseScriptText(`=== PAGINA 1 ===
ACTUL 1
SCENA 1
SGANAREL: Unu.
SGANAREL: Doi.
SGANARELL: Trei.
`);

    expect(parsed.characters).toEqual([
      { name: 'Sganarel', description: null, aliases: ['SGANAREL', 'SGANARELL'] },
    ]);
    expect(parsed.scenes[0]?.lines.map((line) => line.characterName)).toEqual([
      'Sganarel',
      'Sganarel',
      'Sganarel',
    ]);
  });

  it('opens a scene at the act when no scene heading follows', () => {
    const parsed = parseScriptText('ACTUL 1\nHARPAGON: Bună ziua.\n');

    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes[0]?.number).toBe('Actul 1');
    expect(parsed.scenes[0]?.lines[0]).toMatchObject({
      type: 'dialogue',
      characterName: 'Harpagon',
      text: 'Bună ziua.',
    });
  });
});

describe('splitIntoWorks', () => {
  const omnibus = `=== PAGINA 1 ===
Avarul
ACTUL 1
SCENA 1
HARPAGON: Unu.

=== PAGINA 2 ===
Avarul
ACTUL 1
SCENA 2
HARPAGON: Doi.

=== PAGINA 3 ===
Avarul
ACTUL 2
SCENA 1
HARPAGON: Trei.

=== PAGINA 4 ===
Tartuffe
ACTUL 1
SCENA 1
ORGON: Patru.
`;

  it('splits a volume where the act counter restarts', () => {
    const works = splitIntoWorks(omnibus);

    expect(works).toHaveLength(2);
    expect(works[0]?.raw).toContain('HARPAGON: Trei.');
    expect(works[0]?.raw).not.toContain('ORGON: Patru.');
    expect(works[1]?.raw).toContain('ORGON: Patru.');
  });

  it('names a work after the running header repeated on its pages', () => {
    expect(splitIntoWorks(omnibus)[0]?.title).toBe('Avarul');
  });

  it('returns one segment for a single play', () => {
    expect(splitIntoWorks(PLAY)).toHaveLength(1);
  });
});
