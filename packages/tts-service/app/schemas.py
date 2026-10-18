"""Wire format of the TTS service.

The backend mirrors these models in `packages/backend/src/services/tts.client.ts`
(validated there with Zod, since Python cannot import the shared TS schemas),
and the app's own contract lives in `packages/shared/src/tts.ts`.
Keep all three in sync.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Voice(BaseModel):
    """One selectable voice."""

    id: str = Field(description="`<provider>:<voice>`, stable across restarts")
    name: str
    language: str = Field(description="BCP-47 primary subtag, e.g. `ro`")
    gender: Literal["male", "female", "unknown"]
    provider: str


class VoicesResponse(BaseModel):
    """Result of `GET /voices`."""

    voices: list[Voice]
    engine: str = Field(description="Providers that loaded, e.g. `piper+mms`")


class SynthesizeRequest(BaseModel):
    """Body of `POST /synthesize`.

    No speed field on purpose: audio is produced at natural speed and the
    client adjusts playback, so one cache entry serves every rehearsal speed.
    """

    text: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)


class HealthResponse(BaseModel):
    """Result of `GET /health`."""

    status: Literal["ok", "degraded"]
    service: str
    version: str
    engine: str
    ready: bool
    voice_count: int
