"""Osvald OCR service (FastAPI).

Isolated Python service that turns page images into positioned text blocks.
It is deliberately *not* part of the pnpm workspace — the backend talks to it
over HTTP (`OCR_SERVICE_URL`) and Compose runs it as its own container.

PaddleOCR integration is still a TODO: see `app/services/paddle.py`.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
