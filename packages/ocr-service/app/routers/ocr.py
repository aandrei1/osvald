"""Text extraction endpoints: `POST /ocr/pdf` (whole document) and `POST /ocr` (one image)."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.schemas import OcrResponse, PdfTextResponse
from app.services.paddle import get_engine
from app.services.pdf import extract_text

router = APIRouter(tags=["ocr"])


async def _read_upload(upload: UploadFile, limit: int) -> bytes:
    payload = await upload.read()

    if len(payload) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")

    if len(payload) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Upload exceeds the {limit} byte limit",
        )

    return payload


@router.post(
    "/ocr/pdf",
    response_model=PdfTextResponse,
    responses={
        400: {"description": "Empty or malformed upload"},
        413: {"description": "File larger than OCR_MAX_UPLOAD_BYTES"},
        415: {"description": "Not a PDF"},
        422: {"description": "Invalid page range"},
        501: {"description": "Page needs OCR but PaddleOCR is not installed"},
    },
    summary="Extract the text of a PDF, page by page",
)
async def recognize_pdf(
    file: UploadFile = File(..., description="The PDF to read"),
    pages: str = Form("all", description="`all`, `12` (first 12) or `5-20` (inclusive)"),
    language: str | None = Form(None, description="OCR language pack; defaults to OCR_LANGUAGE"),
    scale: float = Form(2.0, gt=0.5, le=6.0, description="Render scale used for OCR"),
    force_ocr: bool = Form(False, description="Ignore the text layer and OCR every page"),
) -> PdfTextResponse:
    """Read a PDF into per-page text.

    Pages that carry a text layer are read directly; pages that do not are
    rendered and sent through PaddleOCR. See `app/services/pdf.py` for why the
    choice is made per page.
    """
    content_type = file.content_type or ""
    filename = file.filename or ""

    if content_type != "application/pdf" and not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=415,
            detail=f"Expected a PDF, got {content_type or 'unknown'}",
        )

    payload = await _read_upload(file, settings.max_upload_bytes)
    resolved_language = language or settings.language

    try:
        # Both strategies are CPU-bound and synchronous, so they must not run on
        # the event loop: a long document would block every other request.
        extraction = await run_in_threadpool(
            extract_text,
            payload,
            pages=pages,
            language=resolved_language,
            scale=scale,
            force_ocr=force_ocr,
            max_ocr_pages=settings.max_ocr_pages,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return PdfTextResponse(
        pages=extraction.pages,
        page_count=extraction.page_count,
        ocr_page_count=extraction.ocr_page_count,
        engine=extraction.engine,
        language=resolved_language,
    )


@router.post(
    "/ocr",
    response_model=OcrResponse,
    responses={
        400: {"description": "Empty or malformed upload"},
        413: {"description": "Image larger than OCR_MAX_UPLOAD_BYTES"},
        415: {"description": "Unsupported media type"},
        501: {"description": "PaddleOCR is not installed in this image"},
    },
    summary="Extract positioned text blocks from a page image",
)
async def recognize(
    image: UploadFile = File(..., description="Page image (PNG, JPEG or TIFF)"),
    page: int = Query(0, ge=0, description="0-based index of the page this image belongs to"),
    language: str | None = Query(
        None, description="Language pack override; defaults to OCR_LANGUAGE"
    ),
) -> OcrResponse:
    """Recognise text in one page image, returning blocks with their positions.

    Kept alongside `/ocr/pdf` for callers that already hold page bitmaps.

    TODO(ocr): stream large uploads to a temporary file instead of buffering the
    whole image in memory.
    """
    content_type = image.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported media type: {content_type or 'unknown'}",
        )

    payload = await _read_upload(image, settings.max_upload_bytes)

    engine = get_engine()
    if language is not None and language != engine.language:
        # A per-request language would mean loading a second model; the service
        # is configured with one language pack at a time.
        raise HTTPException(
            status_code=400,
            detail=f"This instance is configured for '{engine.language}', not '{language}'",
        )

    return await run_in_threadpool(engine.recognize, payload, page)
