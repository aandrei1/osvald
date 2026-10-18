# @osvald/backend

Fastify API for Osvald: scripts, scenes, characters, lines, users — plus the
BullMQ producer for the `script-parsing` queue.

Stack: **Fastify 5 · TypeScript (strict, ESM/nodenext) · Zod 4 via
`fastify-type-provider-zod` · Drizzle ORM + postgres.js · BullMQ + ioredis ·
`@fastify/jwt` · `@fastify/multipart`**.

## Running it

```bash
cp packages/backend/.env.example packages/backend/.env   # first time only

pnpm --filter @osvald/backend db:generate   # (only after schema changes)
pnpm --filter @osvald/backend db:migrate    # create/update tables
pnpm --filter @osvald/backend dev           # http://localhost:3000 (tsx watch)

# the queue consumer runs as its own process:
pnpm --filter @osvald/backend dev:worker

# production-ish
pnpm --filter @osvald/backend build && pnpm --filter @osvald/backend start
```

Requires Postgres and Redis — `pnpm docker:up` at the repo root starts both
(Postgres on host port **5433**, Redis on **6379**).

## Environment variables

Validated by Zod at startup (`src/config/env.ts`); an invalid value aborts the
process with a readable report instead of failing later.

| Variable                        | Default                 | Notes                               |
| ------------------------------- | ----------------------- | ----------------------------------- |
| `NODE_ENV`                      | `development`           |                                     |
| `HOST` / `PORT`                 | `0.0.0.0` / `3000`      |                                     |
| `LOG_LEVEL`                     | `info`                  | pino level (`debug` also logs SQL)  |
| `DATABASE_URL`                  | – (required)            | `postgres://user:pass@host:port/db` |
| `DATABASE_POOL_MAX`             | `10`                    |                                     |
| `REDIS_URL`                     | – (required)            | `redis://host:port`                 |
| `JWT_SECRET`                    | – (required)            | **≥ 32 characters**                 |
| `JWT_EXPIRES_IN`                | `1h`                    |                                     |
| `CORS_ORIGIN`                   | `http://localhost:5173` | comma-separated allowlist           |
| `UPLOAD_DIR`                    | `uploads`               | relative to the package dir         |
| `UPLOAD_MAX_BYTES`              | `26214400` (25 MiB)     | enforced by `@fastify/multipart`    |
| `OCR_SERVICE_URL`               | `http://localhost:8001` | Python OCR service                  |
| `OCR_REQUEST_TIMEOUT_MS`        | `30000`                 | single-image requests               |
| `OCR_PDF_TIMEOUT_MS`            | `900000` (15 min)       | whole-document extraction           |
| `OCR_LANGUAGE`                  | `ro`                    | must match the OCR service's pack   |
| `SCRIPT_PARSING_WORKER_ENABLED` | `true`                  | gates the worker process only       |
| `SCRIPT_PARSING_CONCURRENCY`    | `2`                     |                                     |
| `APP_VERSION`                   | `0.1.0`                 | reported by `/health`               |

## Routes

Everything under `/scripts` requires a bearer token.

| Method   | Path                      | Notes                                                                 |
| -------- | ------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/health`                 | probes Postgres, Redis and OCR; always `200`, reports `ok`/`degraded` |
| `GET`    | `/openapi.json`           | generated from the route schemas                                      |
| `POST`   | `/auth/register`          | Argon2id hash + token; `409` on a duplicate e-mail                    |
| `POST`   | `/auth/login`             | `401` for both unknown e-mail and wrong password, in constant time    |
| `GET`    | `/auth/me`                | the token's user                                                      |
| `GET`    | `/scripts`                | the caller's library; `limit`/`offset` + `total`                      |
| `GET`    | `/scripts/:id`            | script + scenes + lines + characters                                  |
| `GET`    | `/scripts/:id/characters` | the cast alone                                                        |
| `POST`   | `/scripts/upload`         | multipart PDF → disk → `scripts` row → `script-parsing` job           |
| `POST`   | `/scripts/:id/reparse`    | re-runs the pipeline over the stored PDF (`202`)                      |
| `DELETE` | `/scripts/:id`            | removes the row (cascade) and the stored file (`204`)                 |

A script belonging to someone else answers `404`, not `403`: a `403` would
confirm that the id is real.

Errors always use the shared envelope: `{ statusCode, error, message, details? }`.

## Layout

```
src/
├── app.ts                 buildApp(): compilers, connections, plugins, routes
├── index.ts               API process entry (listen + graceful shutdown)
├── config/env.ts          dotenv + Zod validation
├── db/
│   ├── client.ts          postgres.js + Drizzle (lazy connect)
│   ├── mappers.ts         Date → ISO string (row → DTO boundary)
│   └── schema/            users, scripts, scenes, characters, lines, relations
├── plugins/               error-handler (ApiError mapping), auth (@fastify/jwt + authenticate)
├── queue/
│   ├── connection.ts      Redis options for BullMQ + a general ioredis client
│   ├── queues.ts          QueueRegistry decorated as `app.queues`
│   ├── jobs/script-parsing.ts   job payload schema + processor skeleton
│   └── worker.ts          standalone worker process
├── parsing/
│   ├── text-cleanup.ts    page furniture removal, dehyphenation, page splitting
│   └── script-parser.ts   acts/scenes/speakers/directions → ParsedScript
├── routes/                health, scripts, auth (one module per resource)
├── scripts/seed.ts        imports already-extracted text (pnpm db:seed)
├── services/              script, user, health, ocr.client (all thin)
├── lib/                   errors, logger contract, async/timeout helpers
└── types/fastify.d.ts     module augmentation (app.db, app.redis, app.queues, app.authenticate)
```

## Database

Tables: `users`, `scripts`, `scenes`, `characters`, `lines`
(`scripts.status`: `uploaded` → `parsing` → `parsed` | `failed`). Migrations live
in `drizzle/` and are committed; `drizzle-kit` reads `drizzle.config.ts`, which
loads `DATABASE_URL` from `.env`.

## Queue

`script-parsing` (BullMQ) carries `{ scriptId, filePath, mimeType, requestedByUserId }`.
The processor (`src/queue/jobs/script-parsing.ts`) marks the script `parsing`,
sends the PDF to the OCR service, runs `src/parsing/`, then writes scenes,
characters and lines in **one transaction** before marking it `parsed`.

Failures are recorded on the row (`status: 'failed'` + `parse_error`) so the UI
can explain them, then rethrown. Anything that cannot improve on retry — a
corrupt PDF, an OCR image without PaddleOCR — is thrown as `UnrecoverableError`
to skip the backoff.

Re-parsing is idempotent: `saveParseResult()` deletes the previous scenes and
characters inside the same transaction, so a failed re-parse leaves the old
version intact.

## The parser

`src/parsing/` is heuristic by necessity — printed plays carry typographic
convention, not structure. `text-cleanup.ts` strips page furniture (running
headers detected by repetition, folio numbers, footnotes) and repairs
hyphenation; `script-parser.ts` recognises act/scene headings, cast lines,
uppercase speaker labels (including ones whose parenthetical wraps across a
column break) and stage directions.

It never drops text silently: anything it cannot attribute to a speaker is kept
as an unattributed line and counted in `stats.orphanLines`.

## Seeding

`pnpm db:seed` imports already-extracted text through the same parser and
persistence path an upload uses, skipping only the extraction step. See the repo
root README.

## Not implemented (on purpose)

- Refresh-token rotation/revocation, e-mail verification, password reset, and
  rate limiting on `POST /auth/login` (`@fastify/rate-limit`).
- Cheatsheet routes (domain deferred).
- Object storage for uploads (currently the local `uploads/` dir), antivirus
  scanning, `%PDF-` magic-byte checks.
- `@fastify/swagger-ui` (only the JSON spec is exposed today).

## Testing

```bash
pnpm --filter @osvald/backend test          # unit + integration
pnpm --filter @osvald/backend test:watch
```

Unit tests cover `src/parsing/` (the parser and the page cleanup), the row
mappers and the async helpers. Integration tests build the app with
`buildApp()` and drive it through `app.inject()`: the real plugins, Zod
compilers, auth guard and error handler run against a disposable Postgres
database (`osvald_test` by default, override with `TEST_DATABASE_URL`), while
Redis and BullMQ are faked. Without a reachable Postgres the integration suites
skip; the unit suite always runs.
