"""Tests for the PDF → page text pipeline."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.pdf import MIN_TEXT_LAYER_CHARS, extract_text, parse_page_range

# `tests/` → `ocr-service/` → `packages/` → repository root.
SAMPLE_PDF = Path(__file__).resolve().parents[3] / "samples" / "avarul-excerpt.pdf"


class TestParsePageRange:
    def test_all_returns_every_page(self) -> None:
        assert list(parse_page_range("all", 5)) == [0, 1, 2, 3, 4]

    def test_blank_is_treated_as_all(self) -> None:
        assert list(parse_page_range("", 3)) == [0, 1, 2]

    def test_a_bare_number_means_the_first_n_pages(self) -> None:
        assert list(parse_page_range("12", 30)) == list(range(12))

    def test_a_range_is_inclusive_and_one_based(self) -> None:
        assert list(parse_page_range("5-20", 30)) == list(range(4, 20))

    def test_the_range_is_clamped_to_the_document(self) -> None:
        assert list(parse_page_range("0-999", 3)) == [0, 1, 2]

    def test_an_inverted_range_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="invalid page range"):
            parse_page_range("10-2", 30)

    def test_non_numeric_input_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            parse_page_range("abc", 3)


class TestExtractText:
    def test_reads_the_embedded_text_layer_without_ocr(self) -> None:
        extraction = extract_text(
            SAMPLE_PDF.read_bytes(),
            pages="1",
            language="ro",
            max_ocr_pages=0,
        )

        assert extraction.page_count == 1
        assert len(extraction.pages) == 1

        page = extraction.pages[0]
        assert page.page == 1
        assert page.source == "text-layer"
        assert len(page.text.strip()) >= MIN_TEXT_LAYER_CHARS
        assert extraction.ocr_page_count == 0
        assert extraction.engine == "text-layer"

    def test_force_ocr_without_paddle_is_reported_as_not_implemented(self) -> None:
        from app.services.paddle import get_engine

        if get_engine().available:
            pytest.skip("PaddleOCR is installed in this image")

        with pytest.raises(NotImplementedError):
            extract_text(
                SAMPLE_PDF.read_bytes(),
                pages="1",
                language="ro",
                force_ocr=True,
                max_ocr_pages=0,
            )
