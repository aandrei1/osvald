"""Loads the configured providers and routes voice ids to them.

`TTS_PROVIDERS` is a comma-separated list, in preference order. Adding a
commercial engine later means writing one module and putting its name in that
variable — nothing else in the service, the backend or the app changes.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.providers.base import Audio, TtsProvider, UnknownVoiceError, Voice

logger = logging.getLogger("osvald.tts.registry")


class Registry:
    """The loaded providers, as one catalogue of voices."""

    def __init__(self, providers: list[TtsProvider]) -> None:
        self._providers = [provider for provider in providers if provider.available]
        self._by_name = {provider.name: provider for provider in self._providers}

    @property
    def engine(self) -> str:
        """`piper+mms`, or `none` when nothing loaded. Reported by /health."""
        return "+".join(self._by_name) or "none"

    @property
    def ready(self) -> bool:
        return bool(self._providers)

    def voices(self) -> list[tuple[str, Voice]]:
        """Every voice, paired with the public `<provider>:<voice>` id."""
        return [
            (f"{provider.name}:{voice.id}", voice)
            for provider in self._providers
            for voice in provider.voices()
        ]

    def synthesize(self, text: str, voice_id: str) -> Audio:
        provider_name, _, local_id = voice_id.partition(":")
        provider = self._by_name.get(provider_name)

        if provider is None or not local_id:
            raise UnknownVoiceError(voice_id)

        return provider.synthesize(text, local_id)


def build_registry(names: list[str], data_dir: Path, allow_download: bool) -> Registry:
    """Instantiates the named providers, skipping any that fail to load.

    A provider that raises here is logged and dropped rather than fatal: one
    broken engine must not take down a service that has another working one.
    """
    providers: list[TtsProvider] = []

    for name in names:
        try:
            providers.append(_build(name, data_dir, allow_download))
        except Exception:  # noqa: BLE001 - one bad provider must not be fatal
            logger.exception("provider %s failed to load and was skipped", name)

    registry = Registry(providers)
    logger.info("TTS providers ready: %s", registry.engine)

    return registry


def _build(name: str, data_dir: Path, allow_download: bool) -> TtsProvider:
    if name == "piper":
        from app.providers.piper import PiperProvider

        return PiperProvider(data_dir, ["mihai", "amy"])

    if name == "mms":
        from app.providers.mms import MmsProvider

        return MmsProvider(data_dir, allow_download=allow_download)

    # TODO(tts): add `azure` (ro-RO-AlinaNeural is the only free-tier-adjacent
    # Romanian female voice) and `elevenlabs` providers here. Both are plain
    # HTTP clients behind the same `TtsProvider` protocol; they need an API key
    # in the environment and must stay optional, since the offline engines are
    # what make the app work with no account and no network.
    raise ValueError(f"unknown TTS provider: {name}")
