"""Osvald TTS service (FastAPI).

Isolated Python service that turns a line of dialogue into audio. It is
deliberately *not* part of the pnpm workspace — the backend talks to it over
HTTP (`TTS_SERVICE_URL`) and Compose runs it as its own container.

It is separate from the OCR service on purpose: OCR occupies a CPU for minutes
at a time, while a rehearsal needs a line back in well under a second, and one
queue for both would make the interactive path wait behind the batch one.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
