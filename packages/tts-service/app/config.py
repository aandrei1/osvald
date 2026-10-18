"""Runtime configuration, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    """Service settings.

    A plain dataclass, matching `packages/ocr-service`: the Python services
    deliberately avoid pydantic-settings until they have real configuration.
    """

    #: Engines to load, in preference order. See `app/providers/registry.py`.
    providers: list[str]
    #: Where models and the audio cache live. A volume in Docker.
    data_dir: Path
    #: Let a provider fetch its model on first use. Off in locked-down
    #: deployments, where the image is expected to carry the weights.
    allow_download: bool
    #: Longest line the service will synthesise, in characters.
    max_text_length: int
    #: Upper bound on the audio cache, in bytes.
    cache_max_bytes: int
    #: Synthesis jobs allowed to run at once. CPU inference does not benefit
    #: from oversubscription, and queueing beats thrashing.
    max_concurrency: int
    log_level: str
    version: str


def load_settings() -> Settings:
    return Settings(
        providers=_env_list("TTS_PROVIDERS", ["piper", "mms"]),
        data_dir=Path(os.getenv("TTS_DATA_DIR", "/data")),
        allow_download=os.getenv("TTS_ALLOW_DOWNLOAD", "true").lower() == "true",
        max_text_length=_env_int("TTS_MAX_TEXT_LENGTH", 2_000),
        cache_max_bytes=_env_int("TTS_CACHE_MAX_BYTES", 512 * 1024 * 1024),
        max_concurrency=_env_int("TTS_MAX_CONCURRENCY", 2),
        log_level=os.getenv("TTS_LOG_LEVEL", "info"),
        version=os.getenv("TTS_VERSION", "0.1.0"),
    )


settings = load_settings()
