"""Speech endpoints: `GET /voices` and `POST /synthesize`."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.audio import to_wav
from app.cache import AudioCache
from app.config import settings
from app.providers.base import ProviderUnavailableError, UnknownVoiceError
from app.providers.registry import build_registry
from app.schemas import SynthesizeRequest, Voice, VoicesResponse

logger = logging.getLogger("osvald.tts")

router = APIRouter(tags=["tts"])

registry = build_registry(settings.providers, settings.data_dir, settings.allow_download)
cache = AudioCache(settings.data_dir / "cache", settings.cache_max_bytes)

# Inference is CPU-bound and saturates the cores it gets. Without a bound, a
# scene prefetching ahead of itself would queue dozens of parallel runs and
# make every one of them slower than running them in order.
_slots = asyncio.Semaphore(settings.max_concurrency)


@router.get("/voices", response_model=VoicesResponse, summary="Voices the service can speak with")
async def list_voices() -> VoicesResponse:
    return VoicesResponse(
        voices=[
            Voice(
                id=public_id,
                name=voice.name,
                language=voice.language,
                gender=voice.gender,
                provider=public_id.split(":", 1)[0],
            )
            for public_id, voice in registry.voices()
        ],
        engine=registry.engine,
    )


@router.post(
    "/synthesize",
    responses={
        200: {"content": {"audio/wav": {}}, "description": "16-bit PCM WAV, mono"},
        404: {"description": "No loaded provider offers this voice"},
        413: {"description": "Text longer than TTS_MAX_TEXT_LENGTH"},
        503: {"description": "The provider could not be loaded"},
    },
    summary="Speak one line",
)
async def synthesize(request: SynthesizeRequest) -> Response:
    text = request.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    if len(text) > settings.max_text_length:
        raise HTTPException(
            status_code=413,
            detail=f"Text exceeds the {settings.max_text_length} character limit",
        )

    key = AudioCache.key(request.voice_id, text)
    cached = cache.get(key)

    if cached is not None:
        return _wav_response(cached, hit=True)

    async with _slots:
        # Check again: a prefetch for the same line may have landed while this
        # request was queued, which is the common case when a scene runs.
        cached = cache.get(key)
        if cached is not None:
            return _wav_response(cached, hit=True)

        try:
            audio = await run_in_threadpool(registry.synthesize, text, request.voice_id)
        except UnknownVoiceError as error:
            raise HTTPException(status_code=404, detail=f"Unknown voice: {error}") from error
        except ProviderUnavailableError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except Exception as error:  # noqa: BLE001 - surfaced as 500 with a readable message
            logger.exception("synthesis failed for voice %s", request.voice_id)
            raise HTTPException(status_code=500, detail="Synthesis failed") from error

    payload = to_wav(audio.samples, audio.sample_rate)
    cache.put(key, payload)

    return _wav_response(payload, hit=False)


def _wav_response(payload: bytes, hit: bool) -> Response:
    return Response(
        content=payload,
        media_type="audio/wav",
        headers={
            "content-length": str(len(payload)),
            # Same text and voice always give the same audio, so the browser
            # and any proxy in front of us may keep it for a long time.
            "cache-control": "public, max-age=604800, immutable",
            "x-tts-cache": "hit" if hit else "miss",
        },
    )
