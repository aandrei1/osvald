"""Runtime configuration, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """Service settings.

    Kept as a plain dataclass (instead of pydantic-settings) to avoid an extra
    dependency until the service grows real configuration.
    """

    #: OCR language pack passed to PaddleOCR.
    language: str
    #: Upper bound for a single uploaded image or PDF.
    max_upload_bytes: int
    #: Most pages one request may OCR; 0 lifts the cap. Recognition costs
    #: seconds per page, so an unbounded scan would occupy a worker for hours.
    max_ocr_pages: int
    #: uvicorn log level, mostly for the container.
    log_level: str
    #: Reported by GET /health.
    version: str


def load_settings() -> Settings:
    return Settings(
        language=os.getenv("OCR_LANGUAGE", "en"),
        max_upload_bytes=_env_int("OCR_MAX_UPLOAD_BYTES", 64 * 1024 * 1024),
        max_ocr_pages=_env_int("OCR_MAX_OCR_PAGES", 80),
        log_level=os.getenv("OCR_LOG_LEVEL", "info"),
        version=os.getenv("OCR_VERSION", "0.1.0"),
    )


settings = load_settings()
