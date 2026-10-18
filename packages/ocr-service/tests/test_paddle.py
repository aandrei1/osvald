"""Tests for the OCR engine's reading-order and box mapping helpers."""

from __future__ import annotations

import numpy as np

from app.schemas import BoundingBox
from app.services.paddle import _sort_reading_order, _to_bbox


class TestSortReadingOrder:
    def test_orders_rows_top_to_bottom_then_inside_a_row_left_to_right(self) -> None:
        texts = ["below", "right", "left"]
        boxes = np.array(
            [
                [10, 60, 50, 80],  # below
                [60, 12, 100, 32],  # right
                [10, 10, 50, 30],  # left
            ]
        )

        assert _sort_reading_order(texts, boxes) == ["left", "right", "below"]

    def test_returns_the_input_when_boxes_are_missing(self) -> None:
        assert _sort_reading_order(["a", "b"], None) == ["a", "b"]

    def test_returns_the_input_when_the_lengths_disagree(self) -> None:
        assert _sort_reading_order(["a", "b"], [[0, 0, 1, 1]]) == ["a", "b"]

    def test_handles_an_empty_result(self) -> None:
        assert _sort_reading_order([], None) == []


class TestToBbox:
    def test_converts_origin_and_size(self) -> None:
        assert _to_bbox([10, 20, 60, 80]) == BoundingBox(x=10, y=20, width=50, height=60)

    def test_a_missing_box_becomes_zeroes(self) -> None:
        assert _to_bbox(None) == BoundingBox(x=0, y=0, width=0, height=0)

    def test_a_short_box_becomes_zeroes(self) -> None:
        assert _to_bbox([1, 2]) == BoundingBox(x=0, y=0, width=0, height=0)
