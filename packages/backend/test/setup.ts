import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Environment for the test process.
 *
 * `src/config/env.ts` validates `process.env` when it is imported and calls
 * `process.exit(1)` on a bad value, so every variable has to be present before
 * the first test module is loaded. `setupFiles` runs early enough for that.
 *
 * `DATABASE_URL` is forced to the test database — never the development one.
 * Integration suites create that database, run the committed migrations and
 * truncate it between tests; pointing them at `osvald` would wipe real data.
 */

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://osvald:osvald@localhost:5433/osvald_test';

/** Uploads land here instead of the repository's `uploads/` directory. */
const testUploadDir = mkdtempSync(join(tmpdir(), 'osvald-test-uploads-'));

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.HOST = '127.0.0.1';
// `app.inject()` binds nothing, but `env.ts` still validates the value and
// `PORT=0` would fail its `positive()` check.
process.env.PORT = '3000';

// dotenv 18 prints a banner on load; tests have their own output.
process.env.DOTENV_CONFIG_QUIET = 'true';

process.env.DATABASE_URL = testDatabaseUrl;
process.env.TEST_DATABASE_URL = testDatabaseUrl;

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-only-secret-with-at-least-32-characters';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
process.env.UPLOAD_DIR = testUploadDir;

process.env.OCR_SERVICE_URL = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8001';
process.env.TTS_SERVICE_URL = process.env.TTS_SERVICE_URL ?? 'http://127.0.0.1:8002';
process.env.SCRIPT_PARSING_WORKER_ENABLED = 'false';
