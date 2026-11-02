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


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _available_cpus() -> int:
    """CPUs this process may run on — what Docker gives the container, not the host."""
    try:
        return len(os.sched_getaffinity(0))
    except AttributeError:  # not Linux (running the service outside Docker)
        return os.cpu_count() or 1


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
    #: Longest side, in pixels, a page is rendered at before OCR; 0 lifts the
    #: cap. A fixed render scale suits A4 scans but turns a PDF of phone photos
    #: into ~27 MP bitmaps that take minutes and gigabytes per page.
    render_max_side: int
    #: Threads Paddle may use. Defaults to the CPUs the container can see, so
    #: the same image fits a 12-core PC and a smaller Docker VM on a laptop.
    cpu_threads: int
    #: oneDNN CPU kernels: ~5x faster on x86 with Paddle 3.2.2 (measured on a
    #: page of phone photos). Paddle 3.3.x fails with them ("ConvertPirAttribute
    #: 2RuntimeAttribute not support"), so this is the switch if a later upgrade
    #: brings that back. Paddle ignores it on ARM.
    enable_mkldnn: bool
    #: uvicorn log level, mostly for the container.
    log_level: str
    #: Reported by GET /health.
    version: str


def load_settings() -> Settings:
    return Settings(
        language=os.getenv("OCR_LANGUAGE", "en"),
        max_upload_bytes=_env_int("OCR_MAX_UPLOAD_BYTES", 64 * 1024 * 1024),
        max_ocr_pages=_env_int("OCR_MAX_OCR_PAGES", 80),
        render_max_side=_env_int("OCR_RENDER_MAX_SIDE", 2500),
        cpu_threads=max(1, _env_int("OCR_CPU_THREADS", _available_cpus())),
        enable_mkldnn=_env_bool("OCR_ENABLE_MKLDNN", True),
        log_level=os.getenv("OCR_LOG_LEVEL", "info"),
        version=os.getenv("OCR_VERSION", "0.1.0"),
    )


settings = load_settings()
