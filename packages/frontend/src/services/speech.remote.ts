import { BCP47_BY_LANGUAGE } from '@osvald/shared';

import { api } from './api';
import {
  type SpeakOutcome,
  type SpeakRequest,
  type SpeechPlatform,
  type SpeechService,
  type SpeechVoice,
} from './speech';

/**
 * Server-side speech, played back through an `<audio>` element.
 *
 * This is the implementation that makes the app behave the same everywhere.
 * The Web Speech API can only offer voices the operating system has installed,
 * which for Romanian means: present on some Macs, absent on Windows, absent on
 * most Androids, and silently substituted with an English voice when absent —
 * the text then comes out read with English phonetics. Synthesising on the
 * server removes the operating system from the equation entirely.
 *
 * Three details matter here:
 *
 *  - speed is applied with `playbackRate`, not asked of the server, so the
 *    server caches one rendering per line instead of one per line and speed.
 *    `preservesPitch` keeps a fast rehearsal from sounding like a cartoon.
 *  - the next line is prefetched while the current one plays. Synthesis is
 *    0.4–1.5s on CPU, which would otherwise be a silence before every line.
 *  - the browser engine stays available as a fallback. If the server cannot be
 *    reached, a rehearsal in progress degrades to local voices rather than
 *    stopping, and `isDegraded` lets the UI say so.
 */

/**
 * Lines kept as decoded audio.
 *
 * Only a prefetch window is needed, but a scene is replayed constantly while
 * rehearsing, so a generous window costs little and removes most waits. Each
 * entry is a few hundred kilobytes.
 */
const MAX_CACHED_LINES = 60;

export class RemoteSpeechService implements SpeechService {
  readonly platform: SpeechPlatform = 'remote';

  /** Used when the server cannot be reached. */
  private readonly fallback: SpeechService;

  /** Insertion-ordered, so the oldest entry is the first key. */
  private readonly audioByKey = new Map<string, Promise<Blob>>();

  private current: HTMLAudioElement | null = null;
  private settleCurrent: ((outcome: SpeakOutcome) => void) | null = null;
  private objectUrl: string | null = null;

  /** True once a request has failed and playback moved to the local engine. */
  private degraded = false;

  /**
   * Bumped by every `cancel()`.
   *
   * Fetching a line is an await during which the user may well have paused or
   * jumped elsewhere. Without this, a line cancelled mid-download would still
   * start playing once its audio arrived.
   */
  private generation = 0;

  constructor(fallback: SpeechService) {
    this.fallback = fallback;
  }

  isSupported(): boolean {
    return typeof Audio !== 'undefined' || this.fallback.isSupported();
  }

  /** True when the server is unreachable and local voices are being used. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  async listVoices(): Promise<SpeechVoice[]> {
    try {
      const response = await api.listTtsVoices();
      this.degraded = false;

      return response.voices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        lang: BCP47_BY_LANGUAGE[voice.language],
        isDefault: false,
        source: 'server',
      }));
    } catch {
      // No server: fall back to whatever this device has, so the rehearsal
      // still runs. The UI reads `isDegraded` to explain the difference.
      this.degraded = true;
      return this.fallback.listVoices();
    }
  }

  /**
   * Renders a line ahead of time, so playing it later is instant.
   *
   * Failures are swallowed: a prefetch is an optimisation, and the real
   * `speak()` will report the problem if there is one.
   */
  prefetch(request: SpeakRequest): void {
    if (this.degraded || request.voiceId === undefined || request.voiceId === null) {
      return;
    }

    void this.load(request.text, request.voiceId).catch(() => undefined);
  }

  private load(text: string, voiceId: string): Promise<Blob> {
    const key = `${voiceId}\u0000${text}`;
    const existing = this.audioByKey.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const pending = api.speak({ text, voiceId }).catch((error: unknown) => {
      // Do not cache a failure: the server may be back for the next attempt.
      this.audioByKey.delete(key);
      throw error;
    });

    this.audioByKey.set(key, pending);

    while (this.audioByKey.size > MAX_CACHED_LINES) {
      const oldest = this.audioByKey.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.audioByKey.delete(oldest.value);
    }

    return pending;
  }

  async speak(request: SpeakRequest): Promise<SpeakOutcome> {
    const voiceId = request.voiceId;

    // Without a server voice there is nothing to ask the server for. This is
    // the case for a line whose language has no server voice at all.
    if (this.degraded || voiceId === undefined || voiceId === null) {
      return this.fallback.speak(request);
    }

    this.cancel();
    const generation = this.generation;

    let blob: Blob;

    try {
      blob = await this.load(request.text, voiceId);
    } catch {
      this.degraded = true;
      return this.fallback.speak(request);
    }

    // Cancelled while the audio was in flight: the caller has already moved on.
    if (generation !== this.generation) {
      return 'interrupted';
    }

    return this.play(blob, request.rate ?? 1);
  }

  private play(blob: Blob, rate: number): Promise<SpeakOutcome> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.playbackRate = rate;
    // Time-stretch instead of resampling, so a faster rehearsal does not raise
    // the pitch of every character.
    audio.preservesPitch = true;

    this.current = audio;
    this.objectUrl = url;

    return new Promise<SpeakOutcome>((resolve) => {
      let settled = false;

      const settle = (outcome: SpeakOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;

        if (this.current === audio) {
          this.current = null;
          this.settleCurrent = null;
          this.release(url);
        }

        resolve(outcome);
      };

      this.settleCurrent = settle;

      audio.onended = () => {
        settle('completed');
      };
      // A line that will not decode must not stall the scene; treat it as
      // spoken and move on, exactly as the browser engine's watchdog does.
      audio.onerror = () => {
        settle('completed');
      };

      void audio.play().catch(() => {
        // Autoplay was refused (no user gesture yet) or the element was torn
        // down mid-call. Either way the caller must not hang.
        settle('completed');
      });
    });
  }

  private release(url: string): void {
    if (this.objectUrl === url) {
      this.objectUrl = null;
    }
    URL.revokeObjectURL(url);
  }

  cancel(): void {
    this.generation += 1;
    this.fallback.cancel();

    const audio = this.current;
    const settle = this.settleCurrent;

    this.current = null;
    this.settleCurrent = null;

    if (audio !== null) {
      audio.pause();
      // Drop the handlers before clearing `src`: some browsers fire `error`
      // when the source goes away, which would settle the promise twice.
      audio.onended = null;
      audio.onerror = null;
      audio.src = '';
    }

    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    settle?.('interrupted');
  }
}
