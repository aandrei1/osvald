"""The provider contract every speech engine implements.

A provider turns text into a mono waveform. Everything above this layer — the
cache, the routes, the backend, the app — only knows `Voice` and `float32`
samples, so swapping Piper for Azure or ElevenLabs is a new module and an
environment variable, not a change to the pipeline.

Two rules keep that promise:

* audio comes back at natural speed. Playback speed is the client's business
  (``HTMLAudioElement.playbackRate``), which also keeps one cache entry per
  line rather than one per line and speed.
* a provider that cannot load reports ``available = False`` instead of raising
  at import time. A missing model must not take the service down when another
  provider is healthy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

import numpy as np

Gender = Literal["male", "female", "unknown"]


@dataclass(frozen=True)
class Voice:
    """One selectable voice, as the app sees it."""

    #: Local to the provider; the public id is `<provider>:<id>`.
    id: str
    name: str
    #: BCP-47 primary subtag, e.g. `ro`.
    language: str
    gender: Gender


@dataclass(frozen=True)
class Audio:
    """Mono PCM, as produced by a provider."""

    samples: np.ndarray  # float32 in [-1, 1]
    sample_rate: int


@runtime_checkable
class TtsProvider(Protocol):
    """A speech engine."""

    #: Short identifier used as the voice-id prefix, e.g. `piper`.
    name: str

    @property
    def available(self) -> bool:
        """False when the engine could not load (missing model, missing key)."""

    def voices(self) -> list[Voice]:
        """Voices this engine offers. Empty when it is unavailable."""

    def synthesize(self, text: str, voice_id: str) -> Audio:
        """Speak `text` with one of this provider's own voice ids."""


class UnknownVoiceError(ValueError):
    """Raised for a voice id no loaded provider recognises."""


class ProviderUnavailableError(RuntimeError):
    """Raised when the engine exists but could not be loaded."""
