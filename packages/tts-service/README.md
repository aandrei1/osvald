# Osvald TTS service

Server-side speech synthesis for the rehearsal view.

## Why it exists

The browser's Web Speech API can only offer voices the operating system has
installed. For Romanian that means the app behaves differently on every
machine: present on a Mac where the voice was downloaded, absent on Windows,
absent on most Android devices — and when it is absent the engine does not fail,
it reads Romanian text with an English voice, which is close to unintelligible.

Synthesising here removes the operating system from the equation. Every
platform gets the same voices, including the Capacitor builds.

## Contract

Three endpoints, no auth — the service is not exposed publicly; the Fastify
backend proxies it at `/tts/*` and applies authentication there.

| Endpoint           | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `GET /voices`      | Voices the loaded engines offer               |
| `POST /synthesize` | One line in, 16-bit PCM WAV out               |
| `GET /health`      | Ops probe; `degraded` when no provider loaded |

`POST /synthesize` takes `{ "text": "...", "voice_id": "piper:mihai" }` and has
no speed parameter on purpose: audio is produced at natural speed and the app
sets `playbackRate`, so one cache entry serves every rehearsal speed.

## Voices

| Voice id      | Name  | Language | Gender | Engine                        |
| ------------- | ----- | -------- | ------ | ----------------------------- |
| `piper:mihai` | Mihai | ro       | male   | Piper `ro_RO-mihai-medium`    |
| `mms:ron`     | Radu  | ro       | male   | Meta MMS `mms-tts-ron` (ONNX) |
| `piper:amy`   | Amy   | en       | female | Piper `en_US-amy-medium`      |

Both Romanian voices are free, offline and from different models, but both are
male and close in pitch (median F0 ~124 Hz and ~134 Hz over four sentences).
They are told apart by timbre rather than register. There is no free Romanian
female voice of usable quality today — that needs a paid provider, which is
what the provider seam below is for.

Measured on CPU, warm: Piper ~0.4–0.7s and MMS ~1.2–1.6s per line, against
~10ms for a cache hit. The app prefetches the next line while the current one
plays, so the wait is not normally visible.

## Adding a provider

Write a module under `app/providers/` implementing the `TtsProvider` protocol
in `base.py`, register it in `registry.py::_build`, and add its name to
`TTS_PROVIDERS`. Nothing else in the service, the backend or the app changes —
voice ids are `<provider>:<voice>` and the rest of the system only ever sees
that string.

The obvious next ones are Azure (`ro-RO-AlinaNeural` is the female Romanian
voice this catalogue is missing) and ElevenLabs. Both are HTTP clients needing
an API key, and both must stay optional: the offline engines are what let the
app work with no account and no network.

## Configuration

| Variable              | Default     | Meaning                                |
| --------------------- | ----------- | -------------------------------------- |
| `TTS_PROVIDERS`       | `piper,mms` | Engines to load, in preference order   |
| `TTS_DATA_DIR`        | `/data`     | Models and the rendered-line cache     |
| `TTS_ALLOW_DOWNLOAD`  | `true`      | Fetch missing models on first use      |
| `TTS_MAX_TEXT_LENGTH` | `2000`      | Longest line accepted                  |
| `TTS_CACHE_MAX_BYTES` | `536870912` | Cache cap; least recently used evicted |
| `TTS_MAX_CONCURRENCY` | `2`         | Parallel synthesis jobs                |

## Running

```sh
docker compose up -d tts-service      # http://localhost:8002
curl localhost:8002/voices
curl -X POST localhost:8002/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"Bine ai venit acasă.","voice_id":"piper:mihai"}' --output line.wav
```

The image bakes in the models (~100 MB). Build with
`--build-arg TTS_PRELOAD_VOICES=false` to skip that and let the service
download them on first use instead.

Run it in Docker, not on a Mac host: the `piper-tts` 1.8.0 macOS wheels are
built with an absolute espeak-ng data path from the machine that produced them,
and phonemization fails there with a missing `phontab` under a CI runner's
directory. Neither `espeakbridge.initialize()` nor `ESPEAK_DATA_PATH` overrides
it. The Linux wheels in the image are unaffected, and the MMS provider — which
has no espeak dependency — works everywhere.

## Testing

```bash
pnpm test:python:tts        # from the repo root
```

`tests/` covers the WAV encoder, the LRU audio cache and provider/voice routing
(with a fake provider, so no model is loaded). It runs inside the built image:

```bash
docker compose run --rm --no-deps -v "$PWD:/repo" -w /repo/packages/tts-service \
  tts-service sh -c 'pip install --user -q -r requirements-dev.txt && python -m pytest'
```
