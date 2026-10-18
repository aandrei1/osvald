import { Capacitor } from '@capacitor/core';
import { BCP47_BY_LANGUAGE, type SupportedLanguage } from '@osvald/shared';

import { NativeSpeechService } from './speech.native';
import { RemoteSpeechService } from './speech.remote';
import { WebSpeechService } from './speech.web';

/**
 * Text-to-speech contract.
 *
 * There are three implementations behind one interface, and the rehearsal
 * store only ever sees the interface:
 *
 *  - `remote` (the default): audio synthesised by `packages/tts-service` and
 *    played back as a file. This is what makes the app sound the same on every
 *    operating system, which the local engines cannot — the Web Speech API
 *    offers only voices the OS has installed, and a Romanian script on a
 *    machine without a Romanian voice is read with English phonetics.
 *  - `web`: the browser's own engine, used when the server is unreachable.
 *  - `native`: the platform engine behind a Capacitor plugin, for the same
 *    offline role on iOS/Android.
 */

export type SpeechPlatform = 'web' | 'native' | 'remote';

export interface SpeechVoice {
  /** Stable identifier used to remember a cast member's voice. */
  id: string;
  name: string;
  /** BCP-47 tag, e.g. `ro-RO`. */
  lang: string;
  /** True for the engine's default voice. */
  isDefault: boolean;
  /**
   * Where the voice comes from.
   *
   * Worth showing in the UI: `device` voices are whatever this operating
   * system happens to have, so the same script sounds different on another
   * machine — and on a machine with no Romanian voice, wrong.
   */
  source: 'server' | 'device';
}

export interface SpeakRequest {
  text: string;
  /** `SpeechVoice.id`; the engine default is used when omitted or unavailable. */
  voiceId?: string | null;
  /**
   * BCP-47 tag for the text itself, e.g. `ro-RO`.
   *
   * Set even when a voice is given, and especially when none is: an engine
   * handed Romanian without being told reads it with English phonetics, which
   * is the difference between a usable rehearsal and noise.
   */
  lang?: string | null;
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
  /**
   * Renders a line ahead of being asked to speak it, if the engine can.
   *
   * Only the server-backed engine implements this — a local engine has
   * nothing to fetch. Callers treat it as advisory and must not await it.
   */
  prefetch?(request: SpeakRequest): void;
  /** True when a server-backed engine has fallen back to local voices. */
  readonly isDegraded?: boolean;
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

/** The engine used when the server cannot be reached. */
export function createLocalSpeechService(
  platform: SpeechPlatform = detectSpeechPlatform(),
): SpeechService {
  return platform === 'native' ? new NativeSpeechService() : new WebSpeechService();
}

/**
 * The app's speech engine: the server, with the local engine behind it.
 *
 * Server-first is the whole point — it is the only arrangement where a
 * Romanian script sounds the same on a Mac, a Windows laptop and an Android
 * phone. The local engine is kept for the case the server is unreachable,
 * where inconsistent speech still beats none.
 */
export function createSpeechService(platform?: SpeechPlatform): SpeechService {
  return new RemoteSpeechService(createLocalSpeechService(platform));
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

/** The BCP-47 tag a speech engine should be given for a detected language. */
export function speechTagFor(language: SupportedLanguage): string {
  return BCP47_BY_LANGUAGE[language];
}

/** `true` when a voice speaks `language` — `ro-RO`, `ro_RO` and `ro` all match. */
export function voiceSpeaks(voice: SpeechVoice, language: SupportedLanguage): boolean {
  return voice.lang.toLowerCase().replace('_', '-').split('-')[0] === language;
}

/** Every voice the engine offers for `language`, in the order it reported them. */
export function voicesForLanguage(
  voices: SpeechVoice[],
  language: SupportedLanguage,
): SpeechVoice[] {
  return voices.filter((voice) => voiceSpeaks(voice, language));
}

/**
 * One voice for `language`, or `null` when the engine has none installed.
 *
 * Used for lines whose language differs from the rest of the script — a stage
 * direction in English inside a Romanian play, say — where the character's
 * usual voice would be the wrong engine entirely.
 */
export function pickVoiceForLanguage(
  voices: SpeechVoice[],
  language: SupportedLanguage,
): SpeechVoice | null {
  const pool = voicesForLanguage(voices, language);
  return pool.find((voice) => voice.isDefault) ?? pool[0] ?? null;
}

/**
 * Picks a voice per character in the script's language, giving each role a
 * different voice where the engine has enough of them.
 *
 * Distinct voices are what make a rehearsal followable: with one voice for
 * everyone, an actor cannot tell from listening whose cue just ended.
 *
 * When the engine has no voice for the language, characters are left
 * unassigned rather than given an English one. An unassigned character still
 * gets spoken — `speak()` is handed the language tag and the engine does what
 * it can with it — whereas pinning an English voice would force the wrong
 * phonetics and there would be no way to tell afterwards that it was a
 * fallback rather than a choice.
 */
export function assignVoices(
  characterIds: string[],
  voices: SpeechVoice[],
  language: SupportedLanguage,
): Record<string, string> {
  const pool = voicesForLanguage(voices, language);

  if (pool.length === 0) {
    return {};
  }

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
