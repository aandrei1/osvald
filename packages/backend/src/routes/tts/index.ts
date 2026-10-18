import {
  apiErrorSchema,
  synthesizeSpeechBodySchema,
  ttsVoicesResponseSchema,
} from '@osvald/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createTtsClient, TtsServiceError } from '../../services/tts.client.js';

/**
 * `/tts` routes — server-side speech, so the voices do not depend on what the
 * user's operating system happens to have installed.
 *
 * The backend is a thin proxy in front of `packages/tts-service`: it keeps the
 * app talking to one origin (CORS, auth, a single base URL for Capacitor) and
 * keeps the Python service off the public network.
 *
 * TODO(tts): rate-limit `/tts/speak` per user. Synthesis is CPU work on a
 * shared service, and nothing here stops a client asking for a whole play at
 * once; the service's own semaphore bounds parallelism but not volume.
 */
export const ttsRoutes: FastifyPluginAsyncZod = async (app, _opts) => {
  const client = createTtsClient();

  // A script is personal material, and synthesis is expensive. Both routes
  // need an identified caller.
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/voices',
    {
      schema: {
        tags: ['tts'],
        summary: 'Voices the server can read lines with',
        response: {
          200: ttsVoicesResponseSchema,
          503: apiErrorSchema,
        },
      },
    },
    async () => client.listVoices(),
  );

  app.post(
    '/speak',
    {
      schema: {
        tags: ['tts'],
        summary: 'Read one line aloud',
        description:
          'Returns 16-bit PCM WAV. Audio is synthesised at natural speed — the client sets the rehearsal speed with `playbackRate`, so one cached rendering serves every speed.',
        body: synthesizeSpeechBodySchema,
        // No `response` schemas on purpose. A success here is audio, not JSON,
        // and declaring only the error statuses would make the type provider
        // narrow `reply.send()` to those shapes and reject the audio buffer.
        // Errors still go out in the standard `apiErrorSchema` shape.
        produces: ['audio/wav', 'application/json'],
      },
    },
    async (request, reply) => {
      const { text, voiceId } = request.body;

      try {
        const speech = await client.synthesize(text, voiceId);

        return await reply
          .type(speech.contentType)
          .header('x-tts-cache', speech.cached ? 'hit' : 'miss')
          // Same text and voice always produce the same audio.
          .header('cache-control', 'private, max-age=604800, immutable')
          .send(speech.audio);
      } catch (error) {
        if (error instanceof TtsServiceError) {
          // Pass the service's own status through, so the app can tell
          // "unknown voice" from "engine is down" and fall back accordingly.
          return await reply
            .code(error.statusCode)
            .send({ error: error.name, message: error.message, statusCode: error.statusCode });
        }

        throw error;
      }
    },
  );
};
