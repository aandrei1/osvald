import {
  detectLanguage,
  detectLanguageOfLines,
  type Character,
  type Line,
  type SceneWithLines,
  type SupportedLanguage,
} from '@osvald/shared';

import { assignVoices, pickVoiceForLanguage, speechTagFor, type SpeechVoice } from './speech';

/**
 * Language and voice casting for a rehearsal.
 *
 * Everything here is a pure function over the open script and the engine's
 * voice list: the store keeps the refs, this module decides who speaks with
 * what. That split is what makes the rules testable without a Pinia instance or
 * a speech engine.
 */

/**
 * Lines sampled to decide the script's language.
 *
 * A few dozen are plenty — detection is a sum of stopword hits, and reading a
 * full-length play on every change would be wasted work.
 */
export const LANGUAGE_SAMPLE_LINES = 80;

/** Language of the whole script, from a bounded sample of its lines. */
export function detectScriptLanguage(scenes: readonly SceneWithLines[]): SupportedLanguage {
  const sample: string[] = [];

  for (const scene of scenes) {
    for (const line of scene.lines) {
      sample.push(line.text);
      if (sample.length >= LANGUAGE_SAMPLE_LINES) {
        return detectLanguageOfLines(sample);
      }
    }
  }

  return detectLanguageOfLines(sample);
}

/**
 * Language of one line, falling back to the script's.
 *
 * Per line rather than per script because mixed scripts are normal — an English
 * song inside a Romanian play, a quoted foreign phrase — and a line read by the
 * wrong engine is unintelligible even when the rest is fine.
 */
export function languageOf(line: Line, scriptLanguage: SupportedLanguage): SupportedLanguage {
  return detectLanguage(line.text, scriptLanguage);
}

export interface VoicingContext {
  /** Language the script is being rehearsed in. */
  scriptLanguage: SupportedLanguage;
  /** Every voice the engine offers. */
  voices: SpeechVoice[];
  /** The voice chosen for each character, when there is one. */
  voiceByCharacterId: Record<string, string>;
}

/** The voice and BCP-47 tag to speak `line` with. */
export function voiceForLine(
  line: Line,
  context: VoicingContext,
): { voiceId: string | null; lang: string } {
  const lineLanguage = languageOf(line, context.scriptLanguage);
  const assigned =
    line.characterId === null ? undefined : context.voiceByCharacterId[line.characterId];

  // The character's voice only applies while the line is in the language it was
  // chosen for; otherwise fall back to any voice for the line's language.
  const voiceId =
    lineLanguage === context.scriptLanguage && assigned !== undefined
      ? assigned
      : (pickVoiceForLanguage(context.voices, lineLanguage)?.id ?? null);

  return { voiceId, lang: speechTagFor(lineLanguage) };
}

/**
 * Voices for characters that have none yet.
 *
 * Returns only the new assignments, so the caller can merge them without
 * dropping a voice the actor chose by hand.
 */
export function assignVoicesForNewCharacters(
  characters: readonly Character[],
  voices: SpeechVoice[],
  language: SupportedLanguage,
  voiceByCharacterId: Record<string, string>,
): Record<string, string> {
  const unassigned = characters.filter((character) => voiceByCharacterId[character.id] === undefined);

  return unassigned.length === 0
    ? {}
    : assignVoices(unassigned, voices, language, voiceByCharacterId);
}
