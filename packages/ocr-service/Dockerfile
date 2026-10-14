# Osvald OCR service — build context is this folder (packages/ocr-service).
#
#   docker build -t osvald-ocr packages/ocr-service
#   docker build -t osvald-ocr --build-arg WITH_PADDLE=true packages/ocr-service
#
# It is intentionally independent of the Node workspace: the only contract with
# the rest of the system is HTTP (`POST /ocr/pdf`, `POST /ocr`, `GET /health`).

FROM python:3.12-slim AS runtime

# PDFs with a text layer need nothing extra; set this to `true` to add the
# PaddleOCR stack (over a gigabyte) so scanned documents work too.
ARG WITH_PADDLE=false

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

WORKDIR /app

# Dependencies first, so the layer is cached across source changes.
COPY requirements.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# PaddleOCR needs OpenCV's runtime libraries, which the slim image omits.
RUN if [ "$WITH_PADDLE" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
      && rm -rf /var/lib/apt/lists/* \
      && pip install --no-cache-dir -r requirements-ocr.txt; \
    fi

COPY app ./app

# Drop privileges: nothing here needs root at runtime. The switch happens
# before the model download so the weights are cached under the home directory
# the service actually runs from.
RUN useradd --create-home --uid 10001 osvald \
    && chown -R osvald:osvald /app
USER osvald
ENV HOME=/home/osvald

# Pre-download the recognition models so the first request is not also the
# first download. Failure is tolerated: the models are fetched lazily anyway.
ARG OCR_LANGUAGE=en
RUN if [ "$WITH_PADDLE" = "true" ]; then \
      python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='$OCR_LANGUAGE')" || true; \
    fi

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
