import {
  SpeechNotSupportedError,
  type SpeakOutcome,
  type SpeakRequest,
  type SpeechPlatform,
  type SpeechService,
  type SpeechVoice,
} from './speech';

/**
 * Native implementation (iOS/Android through Capacitor).
 *
 * TODO(speech): implement with `@capacitor-community/text-to-speech`:
 *   - `listVoices()`: `TextToSpeech.getSupportedVoices()`, mapping each voice's
 *     index to a stable id
 *   - `speak()`: `await TextToSpeech.speak({ text, lang, rate, voice })`, which
 *     resolves when the utterance finishes — so the outcome is `completed`
 *     unless `cancel()` ran first
 *   - `cancel()`: `TextToSpeech.stop()`
 *   - also set the audio session to mix with other audio on iOS, so a rehearsal
 *     does not kill the user's music between lines
 *
 * The dependency is not added yet: it is a Capacitor plugin and therefore needs
 * a native build (`cap sync` plus an Xcode/Android Studio run) to be testable,
 * which the web prototype does not go through. The browser build is fully
 * functional in the meantime — see `speech.web.ts`.
 */
export class NativeSpeechService implements SpeechService {
  readonly platform: SpeechPlatform = 'native';

  isSupported(): boolean {
    return false;
  }

  async listVoices(): Promise<SpeechVoice[]> {
    return [];
  }

  async speak(_request: SpeakRequest): Promise<SpeakOutcome> {
    throw new SpeechNotSupportedError(this.platform);
  }

  cancel(): void {
    // Nothing to stop until the plugin is wired up.
  }
}
