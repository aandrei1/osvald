"""FastAPI app for the Osvald OCR service."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import __version__
from app.config import settings
from app.routers.ocr import router as ocr_router
from app.schemas import HealthResponse
from app.services.paddle import get_engine

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("osvald.ocr")

app = FastAPI(
    title="Osvald OCR service",
    description=(
        "Reads PDFs for the script-parsing pipeline. `POST /ocr/pdf` returns the "
        "text of every page, using the embedded text layer where there is one and "
        "PaddleOCR where there is not. `POST /ocr` recognises a single page image."
    ),
    version=__version__,
)

app.include_router(ocr_router)


@app.exception_handler(NotImplementedError)
async def not_implemented_handler(_request: Request, exc: NotImplementedError) -> JSONResponse:
    """Unimplemented features answer 501 instead of 500."""
    logger.warning("not implemented: %s", exc)
    return JSONResponse(status_code=501, content={"detail": str(exc) or "Not implemented"})


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["ops"],
    summary="Ops-only liveness probe (used by Docker healthchecks)",
)
async def health() -> HealthResponse:
    """Deliberately outside the OCR contract: container/ops plumbing only.

    `ready` reflects PDF text extraction, which is always available.
    `ocr_available` reports whether the optional PaddleOCR dependency is
    installed, i.e. whether scanned documents can be handled too.

    TODO(ocr): add a `?deep=true` variant that runs a smoke inference, so a
    broken model download is caught before the first real job.
    """
    engine = get_engine()
    return HealthResponse(
        status="ok",
        service="osvald-ocr",
        version=__version__,
        engine=engine.name,
        ready=True,
        ocr_available=engine.available,
    )
