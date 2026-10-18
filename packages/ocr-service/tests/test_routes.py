"""HTTP contract tests for the OCR service."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

# `tests/` → `ocr-service/` → `packages/` → repository root.
SAMPLE_PDF = Path(__file__).resolve().parents[3] / "samples" / "avarul-excerpt.pdf"

client = TestClient(app)


def test_health_reports_pdf_readiness() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "osvald-ocr"
    assert body["ready"] is True
    assert isinstance(body["ocr_available"], bool)


def test_pdf_endpoint_reads_the_text_layer() -> None:
    response = client.post(
        "/ocr/pdf",
        files={"file": ("avarul-excerpt.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        data={"pages": "1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["page_count"] == 1
    assert body["pages"][0]["source"] == "text-layer"
    assert "HARPAGON" in body["pages"][0]["text"]


def test_pdf_endpoint_rejects_a_non_pdf() -> None:
    response = client.post("/ocr/pdf", files={"file": ("notes.txt", b"hello", "text/plain")})

    assert response.status_code == 415


def test_pdf_endpoint_rejects_an_empty_upload() -> None:
    response = client.post("/ocr/pdf", files={"file": ("empty.pdf", b"", "application/pdf")})

    assert response.status_code == 400


def test_pdf_endpoint_rejects_an_inverted_page_range() -> None:
    response = client.post(
        "/ocr/pdf",
        files={"file": ("avarul.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        data={"pages": "10-2"},
    )

    assert response.status_code == 422
