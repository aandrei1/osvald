"""Wire format of the OCR service.

The backend mirrors these models in `packages/backend/src/services/ocr.client.ts`
(validated there with Zod, since Python cannot import the shared TS schemas).
Keep both sides in sync.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Axis-aligned box in pixel coordinates, origin at the top-left."""

    x: float
    y: float
    width: float
    height: float


class TextBlock(BaseModel):
    """One recognised text fragment plus where it sits on the page."""

    text: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: BoundingBox
    page: int = Field(ge=0, description="0-based page index the block came from")


class OcrResponse(BaseModel):
    """Result of `POST /ocr`."""

    blocks: list[TextBlock]
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    language: str


class PdfPageText(BaseModel):
    """Text of a single PDF page, with how it was obtained."""

    page: int = Field(ge=1, description="1-based page number")
    text: str
    source: str = Field(
        description=(
            "`text-layer` (embedded characters), `ocr` (recognised from a render), "
            "`skipped` (needed OCR but the page budget was spent) or `error`"
        )
    )


class PdfTextResponse(BaseModel):
    """Result of `POST /ocr/pdf`."""

    pages: list[PdfPageText]
    page_count: int = Field(ge=0, description="Pages in the document, not only those returned")
    ocr_page_count: int = Field(ge=0, description="Pages that required OCR")
    engine: str
    language: str


class HealthResponse(BaseModel):
    """`GET /health` payload (used by Docker/Compose healthchecks)."""

    status: str
    service: str
    version: str
    engine: str
    ready: bool = Field(description="True when PDF text extraction is usable")
    ocr_available: bool = Field(
        description="True when PaddleOCR is installed, i.e. scanned PDFs are supported"
    )
