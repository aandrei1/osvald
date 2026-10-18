import { z } from 'zod';

import { supportedLanguageSchema } from './language.js';

/**
 * Server-side speech synthesis.
 *
 * The Web Speech API can only offer what the operating system has installed,
 * which makes Romanian a lottery: fine on a Mac with the voice downloaded,
 * silent or English-accented on Windows, Android and most browsers. Synthesis
 * therefore happens on the server (`packages/tts-service`), so every platform
 * gets the same voices. The browser engine stays as an offline fallback.
 *
 * `rate` is deliberately absent from the request: audio is synthesised at
 * natural speed and the client adjusts playback, which keeps one cache entry
 * per line instead of one per line and speed.
 */

export const ttsGenderSchema = z.enum(['male', 'female', 'unknown']);
export type TtsGender = z.infer<typeof ttsGenderSchema>;

export const ttsVoiceSchema = z.object({
  /** `<provider>:<voice>`, stable across restarts — stored per character. */
  id: z.string().min(1),
  name: z.string().min(1),
  language: supportedLanguageSchema,
  gender: ttsGenderSchema,
  /** Which engine produces this voice, for the settings UI and for debugging. */
  provider: z.string().min(1),
});
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

export const ttsVoicesResponseSchema = z.object({
  voices: z.array(ttsVoiceSchema),
  /** Providers that actually loaded, e.g. `piper+mms`. */
  engine: z.string(),
});
export type TtsVoicesResponse = z.infer<typeof ttsVoicesResponseSchema>;

/**
 * A single line to speak.
 *
 * The cap is generous for a line of dialogue but bounded: synthesis is CPU
 * work, and an unbounded request would let one caller occupy a worker.
 */
export const synthesizeSpeechBodySchema = z.object({
  text: z.string().min(1).max(2_000),
  voiceId: z.string().min(1),
});
export type SynthesizeSpeechBody = z.infer<typeof synthesizeSpeechBodySchema>;
