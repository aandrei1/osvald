/**
 * Minimal logger contract.
 *
 * Fastify's pino instance (`app.log`) satisfies it, and standalone processes
 * (the BullMQ worker) use `createConsoleLogger` so they do not need pino
 * itself. Swap in pino/pino-pretty later without touching call sites.
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
  silent: 100,
};

function formatArg(arg: unknown): unknown {
  return arg instanceof Error ? { message: arg.message, name: arg.name, stack: arg.stack } : arg;
}

/** JSON-lines console logger, level-filtered by `LOG_LEVEL`. */
export function createConsoleLogger(level: LogLevel): Logger {
  const threshold = LEVEL_WEIGHT[level];

  const write = (entryLevel: Exclude<LogLevel, 'silent'>, args: unknown[]): void => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) {
      return;
    }

    const line = JSON.stringify({
      level: entryLevel,
      time: new Date().toISOString(),
      msg: args.map(formatArg),
    });

    if (entryLevel === 'error' || entryLevel === 'fatal') {
      process.stderr.write(`${line}\n`);
      return;
    }

    process.stdout.write(`${line}\n`);
  };

  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}

/** Logger that swallows everything — handy for tests and probes. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
