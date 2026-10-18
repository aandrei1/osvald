# Osvald TTS service — build context is this folder (packages/tts-service).
#
#   docker build -t osvald-tts packages/tts-service
#
# It is intentionally independent of the Node workspace: the only contract with
# the rest of the system is HTTP (`GET /voices`, `POST /synthesize`, `GET /health`).

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    TTS_DATA_DIR=/data

WORKDIR /app

# Dependencies first, so the layer is cached across source changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Drop privileges: nothing here needs root at runtime. The switch happens
# before the model download so the weights are cached under the home directory
# the service actually runs from.
RUN useradd --create-home --uid 10001 osvald \
    && mkdir -p /data \
    && chown -R osvald:osvald /app /data
USER osvald
ENV HOME=/home/osvald

# Bake the models into the image so the first rehearsal is not also the first
# download (~100 MB over the two engines). Failure is tolerated: both providers
# fetch lazily as well, as long as TTS_ALLOW_DOWNLOAD is left on.
ARG TTS_PRELOAD_VOICES=true
RUN if [ "$TTS_PRELOAD_VOICES" = "true" ]; then \
      python -c "\
from pathlib import Path;\
from app.providers.piper import PiperProvider;\
from app.providers.mms import MmsProvider;\
d = Path('/data');\
[PiperProvider(d, [v])._voice(v) for v in ('mihai', 'amy')];\
MmsProvider(d)._load()" || true; \
    fi

EXPOSE 8000

# One worker: the models are hundreds of megabytes of resident memory and the
# in-process semaphore already bounds concurrency. Scale with replicas, not
# workers, so each replica keeps its own warm model set.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
