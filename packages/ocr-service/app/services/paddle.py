"""OCR engine abstraction.

PaddleOCR is an optional dependency: the default image ships without it so the
container stays small and boots fast, which is enough for PDFs that already
carry a text layer. When it is installed (`--build-arg WITH_PADDLE=true`) the
engine below handles scanned documents.

The recognition and reading-order logic mirrors `codPython/script.py`, the
standalone script this service was derived from.
"""

from __future__ import annotations

import io
import logging
import threading
from typing import Any, Protocol

from app.config import settings
from app.schemas import BoundingBox, OcrResponse, TextBlock

logger = logging.getLogger("osvald.ocr.engine")


class OcrEngine(Protocol):
    """Contract the FastAPI layer depends on."""

    name: str

    @property
    def available(self) -> bool:
        """False when the optional dependency is not installed."""
        ...

    def recognize(self, image_bytes: bytes, page: int = 0) -> OcrResponse:
        """Return the text blocks found in `image_bytes`."""
        ...


def _sort_reading_order(texts: list[str], boxes: Any) -> list[str]:
    """Order recognised lines top-to-bottom, then left-to-right.

    PaddleOCR returns detections in the order the detector found them, which is
    not reading order. Lines are bucketed into rows using 60% of the median
    glyph height as the tolerance, so a slightly skewed scan still groups
    correctly, then sorted by horizontal position inside each row.
    """
    import numpy as np

    if not texts or boxes is None or len(boxes) != len(texts):
        return texts

    array = np.asarray(boxes).reshape(len(texts), -1)
    tops = array[:, 1]
    lefts = array[:, 0]
    heights = array[:, 3] - array[:, 1]
    tolerance = max(float(np.median(heights)) * 0.6, 1.0)

    order = sorted(range(len(texts)), key=lambda i: (round(tops[i] / tolerance), lefts[i]))
    return [texts[i] for i in order]


class PaddleOcrEngine:
    """PaddleOCR-backed engine.

    The model is built on first use and reused afterwards: loading it costs
    several seconds and downloads weights, so `/health` must stay answerable
    while that happens. A lock keeps two concurrent requests from building two
    copies.
    """

    name = "paddleocr"

    def __init__(self, language: str | None = None) -> None:
        self.language = language or settings.language
        self._model: Any | None = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        try:
            import paddleocr  # noqa: F401
        except ImportError:
            return False
        return True

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model

        with self._lock:
            # Another thread may have finished while this one waited.
            if self._model is not None:
                return self._model

            try:
                from paddleocr import PaddleOCR
            except ImportError as exc:
                raise NotImplementedError(
                    "PaddleOCR is not installed in this image. Rebuild the OCR "
                    "service with `--build-arg WITH_PADDLE=true`, or upload PDFs "
                    "that already carry a text layer."
                ) from exc

            logger.info("loading PaddleOCR (lang=%s)", self.language)
            self._model = PaddleOCR(
                lang=self.language,
                # The extra preprocessing stages only slow down a flatbed scan.
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
            logger.info("PaddleOCR ready")

        return self._model

    def recognize_array(self, image: Any, page: int = 0) -> list[TextBlock]:
        """Run recognition on an already-decoded RGB numpy array."""
        model = self._load_model()
        blocks: list[TextBlock] = []

        for result in model.predict(image):
            texts = list(result.get("rec_texts") or [])
            boxes = result.get("rec_boxes")
            scores = list(result.get("rec_scores") or [])

            ordered = _sort_reading_order(texts, boxes)

            # Boxes are reordered with the texts, so positions are reported per
            # recognised line in reading order rather than detection order.
            for index, text in enumerate(ordered):
                box = None
                if boxes is not None and index < len(boxes):
                    box = boxes[index]

                blocks.append(
                    TextBlock(
                        text=text,
                        confidence=float(scores[index]) if index < len(scores) else 1.0,
                        bbox=_to_bbox(box),
                        page=page,
                    )
                )

        return blocks

    def recognize(self, image_bytes: bytes, page: int = 0) -> OcrResponse:
        import numpy as np
        from PIL import Image

        with Image.open(io.BytesIO(image_bytes)) as opened:
            image = opened.convert("RGB")
            width, height = image.size
            array = np.array(image)

        return OcrResponse(
            blocks=self.recognize_array(array, page=page),
            width=width,
            height=height,
            language=self.language,
        )


def _to_bbox(box: Any) -> BoundingBox:
    """Map a PaddleOCR box (`[x1, y1, x2, y2]`) onto our origin-plus-size shape."""
    if box is None:
        return BoundingBox(x=0.0, y=0.0, width=0.0, height=0.0)

    values = [float(value) for value in list(box)[:4]]
    if len(values) < 4:
        return BoundingBox(x=0.0, y=0.0, width=0.0, height=0.0)

    x1, y1, x2, y2 = values
    return BoundingBox(x=x1, y=y1, width=max(x2 - x1, 0.0), height=max(y2 - y1, 0.0))


_engine: PaddleOcrEngine | None = None


def get_engine() -> PaddleOcrEngine:
    """Process-wide engine, so the loaded model is shared across requests.

    TODO(ocr): switch on an `OCR_ENGINE` env var once a second backend exists
    (a Tesseract fallback or a hosted API).
    """
    global _engine
    if _engine is None:
        _engine = PaddleOcrEngine()
    return _engine
