/**
 * Cue text shown while the actor's own line is hidden.
 *
 * Long enough to recognise the line, short enough that the actor still has to
 * supply it — showing a short line in full would defeat the exercise.
 */

/** Most words of the actor's own line to show as a cue. */
const MAX_CUE_WORDS = 4;

/**
 * The opening words of a line, enough to recognise it but not to read it off.
 *
 * The cap scales with the line: a fixed four words would hand back a short line
 * in full, which is exactly what the actor is supposed to supply from memory.
 */
export function buildCue(text: string): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return '';
  }

  const count = Math.max(1, Math.min(MAX_CUE_WORDS, Math.ceil(words.length / 3)));
  const head = words.slice(0, count).join(' ');

  return words.length > count ? `${head}…` : head;
}
