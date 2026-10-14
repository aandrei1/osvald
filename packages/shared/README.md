# @osvald/shared

Single source of truth for everything that crosses the HTTP boundary: Zod schemas
plus the TypeScript types inferred from them.

Both peers depend on it:

- `@osvald/backend` uses the schemas for Fastify request/response validation and
  serialization (`fastify-type-provider-zod`).
- `@osvald/frontend` uses them to validate every API response at runtime and to
  infer the types it renders.

## Contents

| File           | Exports                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `common.ts`    | `idSchema`, `isoDateTimeSchema`, `paginationQuerySchema`, `apiErrorSchema`, `noContentSchema`, …                                   |
| `line.ts`      | `lineSchema` (+ `lineTypeSchema`: `dialogue` \| `direction`)                                                                       |
| `character.ts` | `characterSchema`, `characterInputSchema`, `characterListResponseSchema`                                                           |
| `scene.ts`     | `sceneSchema`, `sceneWithLinesSchema`, `sceneInputSchema`                                                                          |
| `script.ts`    | `scriptSchema` (incl. `pageCount`, `parseError`), `scriptDetailSchema` (scenes + characters), `scriptStatusSchema`, route payloads |
| `user.ts`      | `userSchema`, `registerBodySchema`, `loginBodySchema`, `authResponseSchema`                                                        |
| `health.ts`    | `healthResponseSchema` (+ per-dependency status)                                                                                   |
| `index.ts`     | barrel + `ZodType` re-export                                                                                                       |

Conventions:

- IDs are UUID strings, timestamps are ISO-8601 UTC **strings** (the backend maps
  `timestamptz` → string in `src/db/mappers.ts`).
- Nullable fields are modelled explicitly (`z.string().nullable()`), never
  `optional()`, so responses have a stable shape.
- `z.infer` types are exported next to every schema — prefer them over
  hand-written interfaces.

`cheatsheet.ts` does not exist yet: the whole cheatsheet domain is deferred (the
barrel file documents where it plugs back in).

## Commands

```bash
pnpm --filter @osvald/shared build      # tsc → dist/ (ESM + .d.ts)
pnpm --filter @osvald/shared dev        # tsc --watch
pnpm --filter @osvald/shared typecheck
pnpm --filter @osvald/shared lint
```

## Consuming it

```ts
import { lineSchema, type Line, type LineType } from '@osvald/shared';

const line: Line = lineSchema.parse(payload);
```

The package publishes **built output** (`dist/`) through `exports`, so build it
before the consumers compile. `pnpm dev` at the repo root runs it in watch mode;
Turbo's `dependsOn: ["^build"]` takes care of ordering for `build`/`typecheck`.

Only `zod` is a runtime dependency. Adding another one here affects every package
— think twice.
