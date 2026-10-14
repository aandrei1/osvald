"""PDF → page text.

Two strategies, picked per page:

* **text layer** — `pypdfium2` reads the characters the producer embedded. Free,
  exact, instant. Covers every digitally produced PDF.
* **OCR** — the page is rendered to a bitmap and handed to PaddleOCR. Needed for
  scans, which have no text layer at all.

Choosing per page rather than per document matters: a scanned book often has a
digital title page, and a digital script sometimes contains scanned inserts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.schemas import PdfPageText

logger = logging.getLogger("osvald.ocr.pdf")

#: Below this many characters a page is treated as having no usable text layer.
MIN_TEXT_LAYER_CHARS = 40


@dataclass(frozen=True)
class PdfExtraction:
    pages: list[PdfPageText]
    page_count: int
    #: Pages that had to go through OCR.
    ocr_page_count: int
    engine: str


def parse_page_range(spec: str, total_pages: int) -> range:
    """Interpret `all`, `12` (first 12) or `5-20` (inclusive, 1-based).

    Mirrors the `--pages` flag of `codPython/script.py` so the two entry points
    behave the same.
    """
    spec = (spec or "all").strip().lower()

    if spec in {"", "all"}:
        first, last = 0, total_pages - 1
    elif "-" in spec:
        start, _, end = spec.partition("-")
        first, last = int(start) - 1, int(end) - 1
    else:
        first, last = 0, int(spec) - 1

    first = max(0, first)
    last = min(last, total_pages - 1)

    if first > last:
        raise ValueError(f"invalid page range {spec!r} for a {total_pages}-page document")

    return range(first, last + 1)


def extract_text(
    pdf_bytes: bytes,
    *,
    pages: str = "all",
    language: str,
    scale: float = 2.0,
    force_ocr: bool = False,
    max_ocr_pages: int = 0,
) -> PdfExtraction:
    """Extract the text of every requested page.

    `max_ocr_pages` caps how many pages may be rendered and recognised (0 means
    no cap). OCR costs seconds per page, so an unbounded 300-page scan would
    hold a queue worker for the better part of an hour; the cap keeps the job
    bounded and reports what was skipped.
    """
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(pdf_bytes)

    try:
        total_pages = len(document)
        page_range = parse_page_range(pages, total_pages)

        results: list[PdfPageText] = []
        ocr_used = 0
        engine_name = "text-layer"

        for page_index in page_range:
            page = document[page_index]

            try:
                text = _read_text_layer(page)
                source = "text-layer"

                needs_ocr = force_ocr or len(text.strip()) < MIN_TEXT_LAYER_CHARS

                if needs_ocr and (max_ocr_pages == 0 or ocr_used < max_ocr_pages):
                    ocr_text = _ocr_page(page, scale=scale, page_index=page_index)

                    # Keep the text layer if OCR did no better (a genuinely
                    # blank page stays blank instead of gaining OCR noise).
                    if len(ocr_text.strip()) > len(text.strip()):
                        text, source = ocr_text, "ocr"
                        ocr_used += 1
                        engine_name = "paddleocr"
                elif needs_ocr:
                    source = "skipped"
            except NotImplementedError:
                # The OCR stack is missing from the image. That is a deployment
                # problem affecting every page, so it must reach the caller as
                # an actionable 501 rather than silently emptying the document.
                page.close()
                raise
            except Exception as exc:  # noqa: BLE001 - one bad page must not fail the document
                logger.warning("page %s failed: %s", page_index + 1, exc)
                text, source = "", "error"
                page.close()
            else:
                page.close()

            results.append(
                PdfPageText(page=page_index + 1, text=text, source=source)
            )

        return PdfExtraction(
            pages=results,
            page_count=total_pages,
            ocr_page_count=ocr_used,
            engine=engine_name,
        )
    finally:
        document.close()


def _read_text_layer(page: object) -> str:
    """Read the embedded characters of one page, in document order."""
    textpage = page.get_textpage()  # type: ignore[attr-defined]
    try:
        return textpage.get_text_bounded()
    finally:
        textpage.close()


def _ocr_page(page: object, *, scale: float, page_index: int) -> str:
    """Render one page to a bitmap and recognise it."""
    import numpy as np

    from app.services.paddle import get_engine

    engine = get_engine()
    if not engine.available:
        raise NotImplementedError(
            "This page has no text layer and PaddleOCR is not installed in the "
            "OCR image. Rebuild it with `--build-arg WITH_PADDLE=true`."
        )

    image = page.render(scale=scale).to_pil().convert("RGB")  # type: ignore[attr-defined]
    blocks = engine.recognize_array(np.array(image), page=page_index)

    return "\n".join(block.text for block in blocks)
