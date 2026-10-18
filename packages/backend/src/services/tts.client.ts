import { ttsVoicesResponseSchema, type TtsVoicesResponse } from '@osvald/shared';
import { z } from 'zod';

import { env } from '../config/env.js';

/**
 * Client for the Python TTS service (`packages/tts-service`).
 *
 * The wire format is defined by that service — see
 * `packages/tts-service/app/schemas.py`. The voice list happens to match the
 * shared schema exactly, so that one is reused; the audio response is bytes
 * and has nothing to validate.
 */

/** Raised when the TTS service answers with an error status. */
export class TtsServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TtsServiceError';
    this.statusCode = statusCode;
  }
}

export interface SynthesizedSpeech {
  audio: Buffer;
  contentType: string;
  /** Whether the service already had this line rendered. */
  cached: boolean;
}

export interface TtsClient {
  /** `GET /voices` — what the loaded engines can speak with. */
  listVoices(): Promise<TtsVoicesResponse>;
  /** `POST /synthesize` — one line in, WAV out. */
  synthesize(text: string, voiceId: string): Promise<SynthesizedSpeech>;
  /** `GET /health` — used by the backend health probe. */
  isHealthy(): Promise<boolean>;
}

/** The service reports its own failures as `{ "detail": "..." }`. */
const errorBodySchema = z.object({ detail: z.unknown() });

async function describeFailure(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = errorBodySchema.safeParse(payload);

  if (parsed.success && typeof parsed.data.detail === 'string') {
    return parsed.data.detail;
  }

  return `TTS service responded with HTTP ${response.status}`;
}

function unreachable(error: unknown): TtsServiceError {
  return new TtsServiceError(
    `TTS service at ${env.TTS_SERVICE_URL} is unreachable: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
    503,
  );
}

export function createTtsClient(): TtsClient {
  return {
    async listVoices(): Promise<TtsVoicesResponse> {
      let response: Response;

      try {
        response = await fetch(`${env.TTS_SERVICE_URL}/voices`, {
          signal: AbortSignal.timeout(env.TTS_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw unreachable(error);
      }

      if (!response.ok) {
        throw new TtsServiceError(await describeFailure(response), response.status);
      }

      return ttsVoicesResponseSchema.parse(await response.json());
    },

    async synthesize(text, voiceId): Promise<SynthesizedSpeech> {
      let response: Response;

      try {
        response = await fetch(`${env.TTS_SERVICE_URL}/synthesize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, voice_id: voiceId }),
          signal: AbortSignal.timeout(env.TTS_SYNTHESIS_TIMEOUT_MS),
        });
      } catch (error) {
        throw unreachable(error);
      }

      if (!response.ok) {
        throw new TtsServiceError(await describeFailure(response), response.status);
      }

      return {
        audio: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'audio/wav',
        cached: response.headers.get('x-tts-cache') === 'hit',
      };
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(`${env.TTS_SERVICE_URL}/health`, {
          signal: AbortSignal.timeout(1_500),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
