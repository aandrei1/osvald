# Osvald OCR service

Isolated Python service that reads PDFs for the script-parsing pipeline. It is
**not part of the pnpm workspace** — the only contract with the rest of the
system is HTTP, and the backend calls it through `OCR_SERVICE_URL`.

Stack: **Python 3.12 · FastAPI · uvicorn · pypdfium2**, with **PaddleOCR** as an
optional extra.

## Two strategies, chosen per page

| Strategy       | When                                  | Cost               |
| -------------- | ------------------------------------- | ------------------ |
| **text layer** | the producer embedded the characters  | instant, no models |
| **OCR**        | the page is a scan with no text layer | seconds per page   |

The choice is made per page, not per document, because a scanned book often has
a digitally produced title page and a digital script sometimes contains scanned
inserts.

The recognition and reading-order logic mirrors `codPython/script.py`, the
standalone script this service was derived from.

## Endpoints

| Method | Path       | Notes                                                                          |
| ------ | ---------- | ------------------------------------------------------------------------------ |
| `POST` | `/ocr/pdf` | multipart `file` (+ `pages`, `language`, `scale`, `force_ocr`) → per-page text |
| `POST` | `/ocr`     | multipart `image` (+ `page`, `language`) → positioned text blocks              |
| `GET`  | `/health`  | ops: reports `ready` and `ocr_available`                                       |
| `GET`  | `/docs`    | FastAPI's interactive docs                                                     |

`pages` accepts `all`, `12` (first 12) or `5-20` (inclusive, 1-based) — the same
syntax as the standalone script's `--pages`.

### `POST /ocr/pdf` response

```json
{
  "pages": [{ "page": 1, "text": "ACTUL 1\nSCENA 1\n…", "source": "text-layer" }],
  "page_count": 113,
  "ocr_page_count": 0,
  "engine": "text-layer",
  "language": "ro"
}
```

`source` is `text-layer`, `ocr`, `skipped` (needed OCR but the page budget was
spent) or `error` (that one page failed; the rest of the document still returns).

### `POST /ocr` response

```json
{
  "blocks": [
    {
      "text": "HARPAGON",
      "confidence": 0.97,
      "bbox": { "x": 72, "y": 118, "width": 96, "height": 22 },
      "page": 0
    }
  ],
  "width": 1240,
  "height": 1754,
  "language": "ro"
}
```

The backend mirrors both shapes in `packages/backend/src/services/ocr.client.ts`
(Zod). **Keep them in sync** — Python cannot import the TypeScript schemas.

## Enabling OCR for scanned PDFs

The default image ships **without** PaddleOCR, so it stays small and boots fast.
That is enough for any PDF with a text layer. For scans:

```bash
# from the repo root
WITH_PADDLE=true docker compose build ocr-service
docker compose up -d ocr-service
```

This adds PaddlePaddle + PaddleX (over a gigabyte) and pre-downloads the models
for `OCR_LANGUAGE`. Check which build is running:

```bash
curl -s localhost:8001/health      # → "ocr_available": true
```

Without it, a page that needs OCR comes back as `skipped`, and a request with
`force_ocr=true` answers **501** with an actionable message rather than silently
returning empty pages.

## Running it

### Docker (how Compose does it)

```bash
docker build -t osvald-ocr packages/ocr-service
docker run --rm -p 8001:8000 osvald-ocr
```

### Locally (needs Python ≥ 3.10)

```bash
cd packages/ocr-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # add -r requirements-ocr.txt for scans
uvicorn app.main:app --reload --port 8000
```

## Environment variables

| Variable               | Default             | Notes                                        |
| ---------------------- | ------------------- | -------------------------------------------- |
| `OCR_LANGUAGE`         | `en`                | language pack; Compose passes `ro`           |
| `OCR_MAX_UPLOAD_BYTES` | `67108864` (64 MiB) | request size guard                           |
| `OCR_MAX_OCR_PAGES`    | `80`                | pages one request may OCR; `0` lifts the cap |
| `OCR_LOG_LEVEL`        | `info`              |                                              |
| `OCR_VERSION`          | `0.1.0`             | reported by `/health`                        |

Read in `app/config.py` (plain `os.getenv` — no extra settings dependency yet).

## Layout

```
app/
├── main.py             FastAPI app, NotImplementedError → 501 handler, /health
├── config.py           env-backed settings
├── schemas.py          Pydantic models = the wire format
├── routers/ocr.py      POST /ocr/pdf, POST /ocr
└── services/
    ├── pdf.py          per-page strategy: text layer, OCR fallback
    └── paddle.py       lazy PaddleOCR engine + reading-order sort
```

Both endpoints run their CPU-bound work through `run_in_threadpool`, so a long
document never blocks the event loop.

## Not implemented (on purpose)

- Streaming large uploads to a temporary file instead of buffering them.
- A second engine behind an `OCR_ENGINE` switch (Tesseract, or a hosted API).
- A `?deep=true` health variant that runs a smoke inference, so a broken model
  download is caught before the first real job.
- Per-request language packs: the service loads one at a time.
- Tests.
