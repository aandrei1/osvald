"""Tests for the float32 → WAV conversion."""

from __future__ import annotations

import io
import wave

import numpy as np

from app.audio import to_wav


def test_writes_mono_16_bit_pcm() -> None:
    samples = np.array([0.0, 0.5, -0.5], dtype=np.float32)
    payload = to_wav(samples, 16_000)

    with wave.open(io.BytesIO(payload), "rb") as handle:
        assert handle.getnchannels() == 1
        assert handle.getsampwidth() == 2
        assert handle.getframerate() == 16_000
        assert handle.getnframes() == 3
        frames = handle.readframes(3)

    values = np.frombuffer(frames, dtype="<i2")
    assert values.tolist() == [0, int(0.5 * 32_767), int(-0.5 * 32_767)]


def test_clips_samples_outside_the_normalised_range() -> None:
    samples = np.array([2.0, -2.0], dtype=np.float32)
    payload = to_wav(samples, 8_000)

    with wave.open(io.BytesIO(payload), "rb") as handle:
        values = np.frombuffer(handle.readframes(2), dtype="<i2")

    assert values.tolist() == [32_767, -32_767]
