"""Piper provider — ONNX VITS models, offline, no API key.

Piper is the default because it costs nothing, runs on CPU faster than
real time (~0.3s for a four-second line) and never sends the script anywhere.
Its Romanian catalogue is one voice, `ro_RO-mihai-medium`, which is why the
MMS provider exists alongside it: two models, two speakers.

Models are downloaded on first use into `TTS_DATA_DIR` and cached there; the
Docker image pre-downloads them so the first request is not also the first
download.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import numpy as np

from app.providers.base import Audio, ProviderUnavailableError, UnknownVoiceError, Voice

logger = logging.getLogger("osvald.tts.piper")

#: Public voice id -> (Piper model name, display name, gender).
#:
#: Romanian has exactly one Piper voice today. English is listed so a script in
#: either language is covered by the same engine.
_MODELS: dict[str, tuple[str, str, str]] = {
    "mihai": ("ro_RO-mihai-medium", "Mihai", "male"),
    "amy": ("en_US-amy-medium", "Amy", "female"),
}

_LANGUAGE_BY_VOICE: dict[str, str] = {"mihai": "ro", "amy": "en"}


class PiperProvider:
    """Speech from Piper ONNX voices."""

    name = "piper"

    def __init__(self, data_dir: Path, voice_ids: list[str]) -> None:
        self._data_dir = data_dir
        self._voice_ids = [v for v in voice_ids if v in _MODELS]
        self._loaded: dict[str, object] = {}
        # Piper's espeak phonemizer is a C library with global state, so one
        # synthesis at a time per process.
        self._lock = threading.Lock()
        self._available = self._probe()

    def _probe(self) -> bool:
        try:
            import piper  # noqa: F401
        except ImportError:
            logger.warning("piper-tts is not installed; the Piper provider is disabled")
            return False

        if not self._voice_ids:
            logger.warning("no Piper voices configured; the Piper provider is disabled")
            return False

        return True

    @property
    def available(self) -> bool:
        return self._available

    def voices(self) -> list[Voice]:
        if not self._available:
            return []

        return [
            Voice(
                id=voice_id,
                name=_MODELS[voice_id][1],
                language=_LANGUAGE_BY_VOICE[voice_id],
                gender=_MODELS[voice_id][2],  # type: ignore[arg-type]
            )
            for voice_id in self._voice_ids
        ]

    def _voice(self, voice_id: str):  # noqa: ANN202 - piper's type, loaded lazily
        """Loads a model on first use and keeps it resident."""
        if voice_id not in self._voice_ids:
            raise UnknownVoiceError(voice_id)

        cached = self._loaded.get(voice_id)
        if cached is not None:
            return cached

        from piper import PiperVoice
        from piper.download_voices import download_voice

        model_name = _MODELS[voice_id][0]
        onnx_path = self._data_dir / f"{model_name}.onnx"

        if not onnx_path.exists():
            logger.info("downloading Piper voice %s", model_name)
            self._data_dir.mkdir(parents=True, exist_ok=True)
            download_voice(model_name, self._data_dir)

        logger.info("loading Piper voice %s", model_name)
        voice = PiperVoice.load(onnx_path, config_path=onnx_path.with_suffix(".onnx.json"))
        self._loaded[voice_id] = voice
        return voice

    def synthesize(self, text: str, voice_id: str) -> Audio:
        if not self._available:
            raise ProviderUnavailableError("piper-tts is not installed")

        voice = self._voice(voice_id)

        with self._lock:
            chunks = [chunk.audio_float_array for chunk in voice.synthesize(text)]

        if not chunks:
            # Punctuation-only input phonemizes to nothing; a silent, valid
            # result keeps the rehearsal loop moving.
            return Audio(np.zeros(0, dtype=np.float32), voice.config.sample_rate)

        return Audio(np.concatenate(chunks).astype(np.float32), voice.config.sample_rate)


# NOTE(piper): the macOS wheels of piper-tts 1.8.0 are built with an absolute
# espeak-ng data path from the machine that produced them, so phonemization
# fails on a Mac host with a missing `phontab` under a CI runner's directory.
# Neither `espeakbridge.initialize()` nor the `ESPEAK_DATA_PATH` environment
# variable overrides it — both were tried. The Linux wheels used by the image
# are unaffected, so the service is run in Docker; see the README.
