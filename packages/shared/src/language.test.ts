import { describe, expect, it } from 'vitest';

import {
  BCP47_BY_LANGUAGE,
  detectLanguage,
  detectLanguageOfLines,
  scoreLanguages,
} from './language.js';

/**
 * The detector decides which voice reads a script aloud, so a wrong answer is
 * audible: Romanian read by an English voice is close to unintelligible.
 */
describe('scoreLanguages', () => {
  it('counts Romanian diacritics, including the cedilla forms OCR produces', () => {
    expect(scoreLanguages('șț')).toEqual({ ro: 6, en: 0 });
    // ş/ţ (cedilla) are the pre-1993 spellings still found in scanned books.
    expect(scoreLanguages('şţ')).toEqual({ ro: 6, en: 0 });
  });

  it('counts stopwords case-insensitively', () => {
    const lower = scoreLanguages('nu stiu ce sa fac');
    const upper = scoreLanguages('NU STIU CE SA FAC');

    expect(lower).toEqual(upper);
    expect(lower.ro).toBeGreaterThan(0);
  });

  it('matches Romanian words typed without diacritics', () => {
    // Plenty of scripts are typed without diacritics; folding must still work.
    const scores = scoreLanguages('Nu stiu ce sa fac, dar trebuie sa spun ceva.');

    expect(scores.ro).toBeGreaterThanOrEqual(6);
    expect(scores.en).toBe(0);
  });

  it('scores English stopwords', () => {
    const scores = scoreLanguages('I do not know what to do.');

    expect(scores.en).toBe(3);
    expect(scores.ro).toBe(0);
  });

  it('ignores words that belong to neither language', () => {
    expect(scoreLanguages('Harpagon Cléante Élise')).toEqual({ ro: 0, en: 0 });
  });
});

describe('detectLanguage', () => {
  it('detects Romanian from diacritics and stopwords', () => {
    expect(detectLanguage('Nu știu ce să fac.')).toBe('ro');
  });

  it('detects Romanian without diacritics', () => {
    expect(detectLanguage('Nu stiu ce sa fac, dar trebuie sa spun ceva.')).toBe('ro');
  });

  it('detects English', () => {
    expect(detectLanguage('I do not know what to do.')).toBe('en');
  });

  it('returns the fallback when the text is too short to call', () => {
    expect(detectLanguage('Da.')).toBe('en');
    expect(detectLanguage('Da.', 'ro')).toBe('ro');
  });

  it('returns the fallback on a tie', () => {
    // One Romanian and one English stopword cancel out.
    expect(scoreLanguages('nu the')).toEqual({ ro: 1, en: 1 });
    expect(detectLanguage('nu the', 'ro')).toBe('ro');
  });

  it('exposes the BCP-47 tags a speech engine expects', () => {
    expect(BCP47_BY_LANGUAGE.ro).toBe('ro-RO');
    expect(BCP47_BY_LANGUAGE.en).toBe('en-US');
  });
});

describe('detectLanguageOfLines', () => {
  it('sums evidence across short lines instead of voting per line', () => {
    // No single line carries enough evidence on its own.
    expect(detectLanguage('Nu.')).toBe('en');
    expect(detectLanguage('Ce.')).toBe('en');
    expect(detectLanguageOfLines(['Nu.', 'Ce.', 'Sa.'])).toBe('ro');
  });

  it('falls back for an empty script', () => {
    expect(detectLanguageOfLines([], 'ro')).toBe('ro');
  });
});
