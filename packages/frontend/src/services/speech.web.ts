import {
  SpeechNotSupportedError,
  type SpeakOutcome,
  type SpeakRequest,
  type SpeechPlatform,
  type SpeechService,
  type SpeechVoice,
} from './speech';

/**
 * Web implementation, backed by the Web Speech API (`window.speechSynthesis`).
 *
 * Three quirks of that API shape this file:
 *
 *  - `getVoices()` is empty on first call in most browsers and fills in later,
 *    announced by a `voiceschanged` event. `listVoices()` waits for it.
 *  - `cancel()` fires neither `onend` nor `onerror` reliably, so a pending
 *    `speak()` would hang forever. Every utterance is tracked and settled by
 *    hand when it is cancelled.
 *  - the first `speak()` must happen inside a user gesture, or the browser
 *    silently refuses it. The rehearsal view only ever starts from a tap.
 *
 * On top of that, an utterance is sometimes dropped without any event at all —
 * most often when no voice is installed. The rehearsal loop awaits `speak()`,
 * so that would stall the scene permanently; the watchdog below bounds the wait.
 */

/**
 * Rough upper bound on speaking rate, in characters per second at rate 1.
 * Real speech runs nearer 15, so this over-estimates on purpose: the watchdog
 * must never fire while an utterance is genuinely still going.
 */
const CHARS_PER_SECOND = 10;
const WATCHDOG_GRACE_MS = 8_000;

function watchdogMs(text: string, rate: number): number {
  const spoken = (text.length / (CHARS_PER_SECOND * Math.max(rate, 0.1))) * 1000;
  return Math.max(spoken, 2_000) + WATCHDOG_GRACE_MS;
}
export class WebSpeechService implements SpeechService {
  readonly platform: SpeechPlatform = 'web';

  /** Settles the in-flight utterance; also used to cut it short. */
  private settleCurrent: ((outcome: SpeakOutcome) => void) | null = null;

  private get synthesis(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;
  }

  isSupported(): boolean {
    return this.synthesis !== null;
  }

  async listVoices(): Promise<SpeechVoice[]> {
    const synthesis = this.synthesis;
    if (synthesis === null) {
      return [];
    }

    const immediate = synthesis.getVoices();
    if (immediate.length > 0) {
      return immediate.map(toSpeechVoice);
    }

    // The list arrives asynchronously. Resolve with whatever exists after the
    // timeout rather than hanging: some browsers never fire the event.
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        synthesis.removeEventListener('voiceschanged', finish);
        resolve(synthesis.getVoices().map(toSpeechVoice));
      };

      const timer = setTimeout(finish, 1_500);
      synthesis.addEventListener('voiceschanged', finish);
    });
  }

  async speak(request: SpeakRequest): Promise<SpeakOutcome> {
    const synthesis = this.synthesis;
    if (synthesis === null) {
      throw new SpeechNotSupportedError(this.platform);
    }

    // Anything still speaking belongs to a previous line.
    this.cancel();

    const utterance = new SpeechSynthesisUtterance(request.text);
    utterance.rate = clamp(request.rate ?? 1, 0.1, 10);
    utterance.pitch = clamp(request.pitch ?? 1, 0, 2);

    if (request.voiceId !== undefined && request.voiceId !== null) {
      const voice = synthesis
        .getVoices()
        .find((candidate) => voiceId(candidate) === request.voiceId);
      if (voice !== undefined) {
        utterance.voice = voice;
        // Safari mismatches voice and language unless both are set.
        utterance.lang = voice.lang;
      }
    }

    return new Promise<SpeakOutcome>((resolve) => {
      let settled = false;

      const settle = (outcome: SpeakOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(watchdog);
        this.settleCurrent = null;
        resolve(outcome);
      };

      // If the engine never reports back, treat the line as spoken and move on:
      // a silent scene is recoverable, a frozen one is not.
      const watchdog = setTimeout(
        () => {
          synthesis.cancel();
          settle('completed');
        },
        watchdogMs(request.text, utterance.rate),
      );

      this.settleCurrent = settle;

      utterance.onend = () => {
        settle('completed');
      };
      utterance.onerror = (event) => {
        // `interrupted`/`canceled` are our own cancel() landing here; anything
        // else is a real failure, but neither should stall the caller.
        settle(
          event.error === 'interrupted' || event.error === 'canceled' ? 'interrupted' : 'completed',
        );
      };

      synthesis.speak(utterance);
    });
  }

  cancel(): void {
    const synthesis = this.synthesis;
    if (synthesis === null) {
      return;
    }

    const settle = this.settleCurrent;
    this.settleCurrent = null;

    synthesis.cancel();
    // Settle after cancel(), since the event may never arrive.
    settle?.('interrupted');
  }
}

/**
 * A stable id for a voice.
 *
 * `voiceURI` is the natural key but is not unique across platforms, so the name
 * is folded in.
 */
function voiceId(voice: SpeechSynthesisVoice): string {
  return `${voice.voiceURI}::${voice.name}`;
}

function toSpeechVoice(voice: SpeechSynthesisVoice): SpeechVoice {
  return {
    id: voiceId(voice),
    name: voice.name,
    lang: voice.lang,
    isDefault: voice.default,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
