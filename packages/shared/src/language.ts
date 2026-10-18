import { z } from 'zod';

/**
 * Language detection for spoken text.
 *
 * A script is read aloud by a speech engine, and an engine told the wrong
 * language mangles the text: Romanian read by an English voice is close to
 * unintelligible. Nothing in the upload flow asks the user what language they
 * wrote in, so it is inferred from the text itself.
 *
 * The detector is deliberately small: two languages, a diacritic signal and a
 * stopword signal. It lives here rather than in the frontend because the
 * parsing worker needs the same answer when it stores a script.
 */

export const supportedLanguageSchema = z.enum(['ro', 'en']);
export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>;

/** BCP-47 tag per language, which is what a speech engine wants. */
export const BCP47_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  ro: 'ro-RO',
  en: 'en-US',
};

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  ro: 'Română',
  en: 'English',
};

/**
 * Characters that only Romanian uses among the languages we support, including
 * the cedilla forms (ş/ţ) that older documents and OCR output still produce
 * instead of the correct comma-below ș/ț.
 */
const ROMANIAN_DIACRITICS = /[ăâîșțşţ]/giu;

/**
 * Common words, chosen so that no token is a real word in the other language.
 *
 * Disjoint sets are not enough: a word only present in one list still misleads
 * if it exists in the other language. `are` is the clearest case — it is a
 * top-20 Romanian verb ("el are") and listing it as English made lines like
 * "Are dreptate" score as English, which handed them an English voice. The
 * mirror cases, `care`, `face` and `mine`, are left out of the Romanian list
 * for the same reason.
 */
const ROMANIAN_WORDS = new Set([
  'si',
  'sa',
  'sunt',
  'este',
  'esti',
  'eram',
  'pentru',
  'din',
  'cu',
  'intr',
  'pe',
  'nu',
  'ce',
  'mai',
  'dar',
  'daca',
  'cand',
  'cum',
  'aici',
  'acolo',
  'acum',
  'bine',
  'asa',
  'foarte',
  'tine',
  'lui',
  'lor',
  'tot',
  'toata',
  'nimic',
  'ceva',
  'vrea',
  'vreau',
  'stiu',
  'spune',
  'poate',
  'trebuie',
  'doamna',
  'domnule',
]);

const ENGLISH_WORDS = new Set([
  'the',
  'and',
  'you',
  'your',
  'was',
  'were',
  'this',
  'that',
  'with',
  'have',
  'has',
  'been',
  'for',
  'not',
  'but',
  'what',
  'when',
  'where',
  'who',
  'why',
  'how',
  'here',
  'there',
  'now',
  'know',
  'think',
  'want',
  'they',
  'them',
  'she',
  'him',
  'her',
  'his',
  'does',
  'did',
  'will',
  'would',
  'should',
  'could',
  'about',
  'because',
]);

/** A diacritic is worth several stopwords: nothing else produces one. */
const DIACRITIC_WEIGHT = 3;

/** Below this the text is too short or too neutral to call. */
const MIN_SCORE = 2;

/**
 * Strips Romanian diacritics so stopword matching works on text that has them
 * and on text that has lost them (plenty of scripts are typed without).
 */
function fold(word: string): string {
  // NFD splits 'ș' into 's' + a combining mark; \p{M} then drops the mark.
  return word
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

export interface LanguageScores {
  ro: number;
  en: number;
}

/** Raw evidence for each language. Exposed mainly so callers can debug. */
export function scoreLanguages(text: string): LanguageScores {
  const diacritics = text.match(ROMANIAN_DIACRITICS)?.length ?? 0;

  let ro = diacritics * DIACRITIC_WEIGHT;
  let en = 0;

  for (const raw of text.split(/[^\p{L}']+/u)) {
    if (raw.length === 0) {
      continue;
    }

    const word = fold(raw);

    if (ROMANIAN_WORDS.has(word)) {
      ro += 1;
    } else if (ENGLISH_WORDS.has(word)) {
      en += 1;
    }
  }

  return { ro, en };
}

/**
 * Best guess at the language of `text`.
 *
 * Returns `fallback` when the evidence is too thin to be worth acting on — a
 * two-word line like "Da." or an interjection says nothing, and guessing there
 * would flip voices mid-scene for no reason.
 */
export function detectLanguage(
  text: string,
  fallback: SupportedLanguage = 'en',
): SupportedLanguage {
  const { ro, en } = scoreLanguages(text);

  if (Math.max(ro, en) < MIN_SCORE || ro === en) {
    return fallback;
  }

  return ro > en ? 'ro' : 'en';
}

/**
 * Language of a whole script, from a sample of its lines.
 *
 * Scores are summed rather than voted on per line: short lines are unreadable
 * individually but their stopwords still add up across a scene.
 */
export function detectLanguageOfLines(
  texts: readonly string[],
  fallback: SupportedLanguage = 'en',
): SupportedLanguage {
  return detectLanguage(texts.join('\n'), fallback);
}
