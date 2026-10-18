import { describe, expect, it } from 'vitest';

import { buildCue } from './rehearsalStore';

/**
 * The cue is what makes the rehearsal work: it has to be long enough to
 * recognise the line and short enough that the actor still has to supply it.
 * Showing a short line in full would defeat the exercise.
 */

describe('buildCue', () => {
  it('returns an empty string for empty text', () => {
    expect(buildCue('')).toBe('');
    expect(buildCue('   ')).toBe('');
  });

  it('shows a single word in full', () => {
    expect(buildCue('Da.')).toBe('Da.');
  });

  it('caps a two-word line at one word plus an ellipsis', () => {
    expect(buildCue('Aici, tată.')).toBe('Aici,…');
  });

  it('scales the cue with the length of the line', () => {
    // 5 words → ceil(5 / 3) = 2
    expect(buildCue('Nu știu ce să fac.')).toBe('Nu știu…');
    // 10 words → ceil(10 / 3) = 4, the hard cap
    expect(buildCue('Unu doi trei patru cinci șase șapte opt nouă zece.')).toBe(
      'Unu doi trei patru…',
    );
  });

  it('never shows more than four words', () => {
    const longLine = 'unu doi trei patru cinci șase șapte opt nouă zece unsprezece doisprezece';

    expect(buildCue(longLine).replace('…', '')).toBe('unu doi trei patru');
  });

  it('normalises repeated whitespace before counting', () => {
    expect(buildCue('Nu   știu ce să fac.')).toBe('Nu știu…');
  });
});
