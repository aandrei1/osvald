import type { Gender } from '@osvald/shared';

import {
  FEMALE_NAMES,
  FEMALE_ROLE_WORDS,
  MALE_NAMES,
  MALE_ROLE_WORDS,
  MALE_SURNAME_SUFFIXES,
  NAME_PARTICLES,
} from './gender-lexicon.js';

export interface GenderClassifierInput {
  name: string;
  /** Cast-list note, e.g. `fiica lui Harpagon`. */
  description: string | null;
}

/** Guesses a role's gender. Swappable, so a model-based one can replace the rules. */
export interface GenderClassifier {
  classify(character: GenderClassifierInput): Gender;
}

function words(text: string): string[] {
  return text.toLocaleLowerCase('ro').match(/\p{L}+/gu) ?? [];
}

function stripDiacritics(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '');
}

function fromLexicon(word: string): Gender {
  if (FEMALE_ROLE_WORDS.has(word)) {
    return 'female';
  }
  if (MALE_ROLE_WORDS.has(word)) {
    return 'male';
  }
  return 'unknown';
}

/** The note usually opens with the role: `fiica lui…`, `servitorul lui…`, `o văduvă`. */
function fromNote(description: string | null): Gender {
  const [first] = words(description ?? '');
  if (first === undefined) {
    return 'unknown';
  }

  if (first === 'o') {
    return 'female';
  }
  if (first === 'un') {
    return 'male';
  }

  const word = stripDiacritics(first);
  const known = fromLexicon(word);
  if (known !== 'unknown') {
    return known;
  }

  // Definite articles: `-ul` is masculine, `-a` feminine. `-ă` is not checked
  // here: on an adjective (`bătrână`) it would also catch nouns like `slugă`.
  if (word.length > 3 && word.endsWith('ul')) {
    return 'male';
  }
  if (first.endsWith('a') && word.length > 3) {
    return 'female';
  }

  return 'unknown';
}

/** Endings, for a first word no list knows. `raw` keeps its diacritics. */
function fromEnding(raw: string): Gender {
  const word = stripDiacritics(raw);

  // Romanian male diminutives: Rică, Ghiță, Mitică. Female ones end in plain `-a`.
  if (raw.endsWith('ă')) {
    return 'male';
  }
  if (word.length > 3 && word.endsWith('ul')) {
    return 'male';
  }
  if (MALE_SURNAME_SUFFIXES.some((suffix) => word.endsWith(suffix))) {
    return 'male';
  }
  if (word.endsWith('a')) {
    return 'female';
  }
  // `-e` and `-y` go both ways (Élise/Cléante, Betty/Harry) and stay unknown.
  if (/[^aeyă]$/u.test(word)) {
    return 'male';
  }

  return 'unknown';
}

function fromName(name: string): Gender {
  const [first] = words(name);
  if (first === undefined) {
    return 'unknown';
  }

  const word = stripDiacritics(first);

  const known = fromLexicon(word);
  if (known !== 'unknown') {
    return known;
  }

  // `La Flèche` is Molière's valet: the particle hides the gender.
  if (NAME_PARTICLES.has(word)) {
    return 'unknown';
  }

  if (FEMALE_NAMES.has(word)) {
    return 'female';
  }
  if (MALE_NAMES.has(word)) {
    return 'male';
  }

  return fromEnding(first);
}

/**
 * Romanian-first rules: the cast-list note wins, then a title or role noun at
 * the start of the name, then a first-name list, then word endings.
 *
 * Anything the rules cannot settle stays `unknown`; the actor corrects it in
 * the app and the correction survives a reparse.
 *
 * TODO: [read gender agreement in stage directions, e.g. `intră Veta, supărată`]
 */
export class RuleBasedGenderClassifier implements GenderClassifier {
  classify(character: GenderClassifierInput): Gender {
    const fromDescription = fromNote(character.description);
    return fromDescription !== 'unknown' ? fromDescription : fromName(character.name);
  }
}
