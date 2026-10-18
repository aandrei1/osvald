"""Tests for provider loading and voice routing."""

from __future__ import annotations

import numpy as np
import pytest

from app.providers.base import Audio, UnknownVoiceError, Voice
from app.providers.registry import Registry


class FakeProvider:
    """Minimal engine that satisfies the `TtsProvider` contract."""

    name = "fake"

    def __init__(self, available: bool = True) -> None:
        self.available = available

    def voices(self) -> list[Voice]:
        return [Voice(id="one", name="One", language="ro", gender="female")]

    def synthesize(self, text: str, voice_id: str) -> Audio:
        return Audio(
            samples=np.full(max(len(text), 1), 0.1, dtype=np.float32),
            sample_rate=16_000,
        )


def test_exposes_public_provider_voice_ids() -> None:
    registry = Registry([FakeProvider()])

    assert registry.ready is True
    assert registry.engine == "fake"
    assert registry.voices() == [
        ("fake:one", Voice(id="one", name="One", language="ro", gender="female"))
    ]


def test_skips_unavailable_providers() -> None:
    registry = Registry([FakeProvider(available=False)])

    assert registry.ready is False
    assert registry.engine == "none"
    assert registry.voices() == []


def test_routes_synthesis_to_the_owning_provider() -> None:
    audio = Registry([FakeProvider()]).synthesize("Bună", "fake:one")

    assert audio.sample_rate == 16_000
    assert len(audio.samples) == len("Bună")


def test_rejects_unknown_voice_ids() -> None:
    registry = Registry([FakeProvider()])

    with pytest.raises(UnknownVoiceError):
        registry.synthesize("Bună", "missing:one")

    # A voice id without the `<provider>:` prefix is not routable either.
    with pytest.raises(UnknownVoiceError):
        registry.synthesize("Bună", "fake")
