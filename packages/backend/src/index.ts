import { buildApp } from './app.js';
import { env } from './config/env.js';

/**
 * API process entry point.
 *
 * The BullMQ consumer is a separate process on purpose:
 *   pnpm --filter @osvald/backend dev:worker
 */

async function main(): Promise<void> {
  const app = await buildApp();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(
      `Osvald API ready on http://${env.HOST}:${env.PORT} (env=${env.NODE_ENV}, openapi=/openapi/json)`,
    );
  } catch (error) {
    app.log.error({ err: error }, 'failed to start');
    process.exit(1);
  }
}

await main();
