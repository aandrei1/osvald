# @osvald/frontend

Vue 3 + Vite + TypeScript app for Osvald, using **Ionic Vue** for UI and
navigation and **Capacitor** for the iOS/Android builds. State lives in Pinia
(`authStore`, `scriptStore`, `rehearsalStore`); the API client and the speech
layer are separate services.

## Running it

```bash
cp packages/frontend/.env.example packages/frontend/.env   # first time only

pnpm --filter @osvald/frontend dev        # http://localhost:5173
pnpm --filter @osvald/frontend build      # vue-tsc + vite build → dist/
pnpm --filter @osvald/frontend preview    # serve the build on :4173
pnpm --filter @osvald/frontend typecheck
```

The backend must be running for data (`pnpm docker:up` or
`pnpm --filter @osvald/backend dev`). Its URL comes from `VITE_API_BASE_URL`
(default `http://localhost:3000`) and the backend's `CORS_ORIGIN` allowlist must
include the origin you serve from (5173 and 4173 are preconfigured).

## Native builds (Capacitor)

```bash
pnpm --filter @osvald/frontend build
pnpm --filter @osvald/frontend cap:add:ios        # once per platform
pnpm --filter @osvald/frontend cap:add:android
pnpm --filter @osvald/frontend cap:sync           # after every web build
pnpm --filter @osvald/frontend cap:open:ios
```

`capacitor.config.ts` targets `app.osvald.rehearsal` and reads `dist/`. The
native projects are generated on demand and are not committed yet. While
developing against an API on your machine, set `server.url` (LAN IP) in that
config — `capacitor://localhost` cannot reach your host.

## Layout

```
src/
├── main.ts               app bootstrap (Ionic styles + IonicVue + Pinia + router)
├── App.vue               ion-app + router outlet
├── router/index.ts       @ionic/vue-router routes + the auth guard
├── views/                LoginPage, HomePage, ScriptDetailPage, RehearsalPage
├── components/           HealthStatusCard, ScriptListItem, LineRow
├── stores/
│   ├── authStore.ts      token + user; registers the client's token provider
│   ├── scriptStore.ts    library, upload, parse-status polling
│   └── rehearsalStore.ts the rehearsal engine (see below)
├── services/
│   ├── api.ts            typed fetch client: shared Zod schemas validate every response
│   ├── speech.ts         SpeechService contract + web/native factory (the seam)
│   ├── speech.web.ts     Web Speech API implementation
│   └── speech.native.ts  Capacitor plugin implementation — TODO
├── composables/useHealth.ts   shared health state for the diagnostics card
└── theme/variables.css   Ionic CSS variables (palette TODO)
```

## The rehearsal engine

`stores/rehearsalStore.ts` walks the current scene's lines. Lines belonging to
other characters are spoken with that character's assigned voice and the engine
advances when the utterance ends. On one of the actor's own lines it stops,
hides the text behind a short cue and waits for an explicit tap — how long a
line takes is the actor's business, so a timer would either rush them or stall
the scene.

Every `await speech.speak()` is a point at which the user may have paused or
jumped elsewhere, so each loop captures a token and exits when it no longer
matches. That is what keeps a stale loop from resuming over a new one.

## Speech abstraction

`services/speech.ts` defines the contract (`isSupported`, `listVoices`, `speak`,
`cancel`) plus a factory that picks an implementation from
`Capacitor.isNativePlatform()`.

The web implementation is complete and works around three Web Speech API quirks
documented in the file: voices arriving asynchronously, `cancel()` not settling
pending utterances, and utterances occasionally being dropped with no event at
all (a watchdog bounds that wait, because the rehearsal loop awaits `speak()`).

**Dependency decision pending:** the native implementation needs
`@capacitor-community/text-to-speech`, and running a scene will want a keep-awake
plugin. Neither is installed, because both need a native build to test.

## Auth

`authStore` keeps the token in `localStorage` and hands the API client a token
provider plus an "unauthorized" callback, so the client never imports a store
(that would be a cycle). The router guard awaits `restoreSession()` before
deciding, so a page reload does not bounce the actor to the sign-in screen.

**This is prototype-grade:** on native the token belongs in the
Keychain/Keystore, and there is no refresh-token rotation yet.

## Not implemented (on purpose)

- Native speech (the Capacitor builds run silently).
- Upload progress percentage, offline script cache.
- Cheatsheet UI (domain deferred; the `cheatsheetStore` does not exist yet).

## Testing

```bash
pnpm --filter @osvald/frontend test
pnpm --filter @osvald/frontend test:watch
```

`happy-dom` (no browser) covers the speech helpers, `buildCue` and the Pinia
stores. The API client is mocked, so the tests describe the stores' state
machine rather than HTTP.
