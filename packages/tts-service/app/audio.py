"""Turning provider output into bytes a browser can play.

WAV is the format on the wire: every browser decodes it, it needs no encoder
dependency, and a line of dialogue is a few hundred kilobytes — small enough
that the simplicity is worth more than the bandwidth.
"""

from __future__ import annotations

import io
import wave

import numpy as np

#: Full-scale for signed 16-bit PCM.
_MAX_INT16 = 32_767


def to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    """Mono float32 in [-1, 1] to a 16-bit PCM WAV file."""
    pcm = np.clip(samples, -1.0, 1.0) * _MAX_INT16
    buffer = io.BytesIO()

    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.astype("<i2").tobytes())

    return buffer.getvalue()
