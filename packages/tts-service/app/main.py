"""FastAPI app for the Osvald TTS service."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app import __version__
from app.config import settings
from app.routers.tts import registry, router as tts_router
from app.schemas import HealthResponse

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("osvald.tts")

app = FastAPI(
    title="Osvald TTS service",
    description=(
        "Reads lines aloud for the rehearsal view. `GET /voices` lists what the "
        "loaded engines offer; `POST /synthesize` returns one line as WAV. "
        "Synthesis is server-side so the voices are the same on every platform, "
        "instead of whatever the operating system happens to have installed."
    ),
    version=__version__,
)

app.include_router(tts_router)


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["ops"],
    summary="Ops-only liveness probe (used by Docker healthchecks)",
)
async def health() -> HealthResponse:
    """`ready` is false when no provider loaded, i.e. nothing can be spoken.

    The status is `degraded` rather than an error so the container still passes
    its healthcheck: the app falls back to browser speech, and a human can see
    from this payload that the server engines need attention.
    """
    voices = registry.voices()

    return HealthResponse(
        status="ok" if registry.ready else "degraded",
        service="osvald-tts",
        version=__version__,
        engine=registry.engine,
        ready=registry.ready,
        voice_count=len(voices),
    )
