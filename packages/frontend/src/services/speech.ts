import { Capacitor } from '@capacitor/core';

import { NativeSpeechService } from './speech.native';
import { WebSpeechService } from './speech.web';

/**
 * Text-to-speech contract.
 *
 * Speech is the one area where the web and native builds genuinely differ (the
 * Web Speech API in a browser, a platform TTS engine behind a Capacitor plugin
 * on iOS/Android), so it is expressed as an interface with one implementation
 * per platform behind a single factory. The rehearsal store only ever sees this
 * interface.
 */

export type SpeechPlatform = 'web' | 'native';

export interface SpeechVoice {
  /** Stable identifier used to remember a cast member's voice. */
  id: string;
  name: string;
  /** BCP-47 tag, e.g. `ro-RO`. */
  lang: string;
  /** True for the engine's default voice. */
  isDefault: boolean;
}

export interface SpeakRequest {
  text: string;
  /** `SpeechVoice.id`; the engine default is used when omitted or unavailable. */
  voiceId?: string | null;
  /** 1 = normal speed. */
  rate?: number;
  pitch?: number;
}

/**
 * Why a `speak()` call finished.
 *
 * The distinction matters to the rehearsal loop: it advances to the next line
 * on `completed`, and stops on `interrupted` because something else — a pause,
 * a jump to another line — already decided what happens next.
 */
export type SpeakOutcome = 'completed' | 'interrupted';

export interface SpeechService {
  readonly platform: SpeechPlatform;

  /** False when the platform has no usable speech engine. */
  isSupported(): boolean;
  /** Voices the engine offers. Resolves once the list is populated. */
  listVoices(): Promise<SpeechVoice[]>;
  /** Speaks `text`, resolving when the utterance ends or is cut short. */
  speak(request: SpeakRequest): Promise<SpeakOutcome>;
  /** Stops immediately and drops anything queued. */
  cancel(): void;
}

export class SpeechNotSupportedError extends Error {
  constructor(platform: SpeechPlatform) {
    super(
      platform === 'web'
        ? 'This browser has no speech synthesis support, so lines cannot be read aloud.'
        : 'Native speech synthesis is not wired up yet — see src/services/speech.native.ts',
    );
    this.name = 'SpeechNotSupportedError';
  }
}

/** `'native'` inside a Capacitor shell (iOS/Android), `'web'` in the browser. */
export function detectSpeechPlatform(): SpeechPlatform {
  return Capacitor.isNativePlatform() ? 'native' : 'web';
}

export function createSpeechService(
  platform: SpeechPlatform = detectSpeechPlatform(),
): SpeechService {
  return platform === 'native' ? new NativeSpeechService() : new WebSpeechService();
}

let sharedInstance: SpeechService | undefined;

/**
 * Lazily created, app-wide service instance.
 *
 * Created on first use rather than at import time, so a platform without speech
 * support cannot break app boot.
 */
export function getSpeechService(): SpeechService {
  sharedInstance ??= createSpeechService();
  return sharedInstance;
}

/**
 * Picks a voice per character, preferring the script's language and giving each
 * role a different voice where the engine has enough of them.
 *
 * Distinct voices are what make a rehearsal followable: with one voice for
 * everyone, an actor cannot tell from listening whose cue just ended.
 */
export function assignVoices(
  characterIds: string[],
  voices: SpeechVoice[],
  preferredLang = 'ro',
): Record<string, string> {
  if (voices.length === 0) {
    return {};
  }

  const matching = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(preferredLang.toLowerCase()),
  );
  const pool = matching.length > 0 ? matching : voices;

  const assignment: Record<string, string> = {};

  for (const [index, characterId] of characterIds.entries()) {
    // Round-robin: with fewer voices than roles some sharing is unavoidable.
    const voice = pool[index % pool.length];
    if (voice !== undefined) {
      assignment[characterId] = voice.id;
    }
  }

  return assignment;
}
