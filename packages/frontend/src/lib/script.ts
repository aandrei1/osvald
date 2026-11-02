import type { Character, SceneWithLines } from '@osvald/shared';

/**
 * Selectors over a parsed script.
 *
 * Plain functions rather than computed properties: the store stays a one-liner
 * and the logic can be tested without a Pinia instance.
 */

/** `characterId → display name`, for the rehearsal UI. */
export function buildCharacterNames(characters: readonly Character[]): Record<string, string> {
  return Object.fromEntries(characters.map((character) => [character.id, character.name]));
}

/** How many lines each character speaks, across every scene. */
export function countLinesByCharacter(scenes: readonly SceneWithLines[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const scene of scenes) {
    for (const line of scene.lines) {
      if (line.characterId !== null) {
        counts[line.characterId] = (counts[line.characterId] ?? 0) + 1;
      }
    }
  }

  return counts;
}
