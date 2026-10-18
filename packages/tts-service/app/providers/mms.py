"""Meta MMS provider — the second free Romanian voice.

Piper offers exactly one Romanian voice, and a rehearsal with one voice for
every character is hard to follow. Meta's Massively Multilingual Speech has a
Romanian VITS checkpoint by a different speaker, published as ONNX, so a second
voice costs a 38 MB download and no API key.

It is a character-level model with no phonemizer, which has two consequences
handled below: its alphabet is small (no `k`, `w`, `y`, no digits beyond `1`,
and `ț`/`ş` only in the opposite encoding), and it exposes no speed control —
which costs nothing here, since playback speed is the client's job.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from urllib.request import urlopen

import numpy as np

from app.providers.base import Audio, ProviderUnavailableError, UnknownVoiceError, Voice

logger = logging.getLogger("osvald.tts.mms")

_REPO = "https://huggingface.co/Xenova/mms-tts-ron/resolve/main"
_FILES = {"model.onnx": f"{_REPO}/onnx/model_quantized.onnx", "vocab.json": f"{_REPO}/vocab.json"}

#: MMS ships 16 kHz audio.
_SAMPLE_RATE = 16_000

#: The checkpoint is single-speaker, so one voice id.
_VOICE_ID = "ron"

#: The vocabulary is inconsistent about Romanian's two t/s pairs: it has the
#: cedilla `ţ` but the comma-below `ș`. Map input onto whichever one it knows.
_ENCODING_FIXES = {"ț": "ţ", "ş": "ș"}

#: Letters outside the vocabulary, approximated rather than dropped: a name
#: like "Kafka" should not come out as "afa".
_TRANSLITERATIONS = {"k": "c", "w": "v", "y": "i", "q": "c"}

#: Only `1` is in the vocabulary, so digits are spoken as words.
_DIGITS = {
    "0": "zero",
    "1": "unu",
    "2": "doi",
    "3": "trei",
    "4": "patru",
    "5": "cinci",
    "6": "șase",
    "7": "șapte",
    "8": "opt",
    "9": "nouă",
}


class MmsProvider:
    """Speech from Meta's MMS Romanian checkpoint, run with onnxruntime."""

    name = "mms"

    def __init__(self, data_dir: Path, allow_download: bool = True) -> None:
        self._dir = data_dir / "mms-ron"
        self._allow_download = allow_download
        self._session: object | None = None
        self._vocab: dict[str, int] | None = None
        # onnxruntime sessions are thread-safe, but one synthesis already
        # saturates the CPU; serialising keeps latency predictable.
        self._lock = threading.Lock()
        self._available = self._probe()

    def _probe(self) -> bool:
        try:
            import onnxruntime  # noqa: F401
        except ImportError:
            logger.warning("onnxruntime is not installed; the MMS provider is disabled")
            return False

        return True

    @property
    def available(self) -> bool:
        return self._available

    def voices(self) -> list[Voice]:
        if not self._available:
            return []

        # The model card names no speaker, so "Radu" is only a label and the
        # gender is measured rather than assumed: over four Romanian sentences
        # the median F0 is ~134 Hz against Piper's ~124 Hz. Both Romanian
        # voices are therefore male and close in pitch — they are different
        # speakers and tell apart by timbre, but a cast that needs an
        # unmistakable contrast wants a third voice from a paid provider.
        return [Voice(id=_VOICE_ID, name="Radu", language="ro", gender="male")]

    def _ensure_files(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)

        for name, url in _FILES.items():
            path = self._dir / name
            if path.exists():
                continue
            if not self._allow_download:
                raise ProviderUnavailableError(f"{path} is missing and downloads are disabled")

            logger.info("downloading MMS file %s", name)
            # Write beside the target and rename, so an interrupted download
            # cannot leave a truncated model that looks complete next boot.
            staging = path.with_suffix(path.suffix + ".part")
            with urlopen(url) as response, staging.open("wb") as handle:  # noqa: S310
                while chunk := response.read(1 << 20):
                    handle.write(chunk)
            staging.replace(path)

    def _load(self) -> tuple[object, dict[str, int]]:
        if self._session is not None and self._vocab is not None:
            return self._session, self._vocab

        import onnxruntime as ort

        self._ensure_files()

        logger.info("loading MMS Romanian model")
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._session = ort.InferenceSession(str(self._dir / "model.onnx"), options)
        self._vocab = json.loads((self._dir / "vocab.json").read_text(encoding="utf-8"))

        return self._session, self._vocab

    def synthesize(self, text: str, voice_id: str) -> Audio:
        if not self._available:
            raise ProviderUnavailableError("onnxruntime is not installed")
        if voice_id != _VOICE_ID:
            raise UnknownVoiceError(voice_id)

        session, vocab = self._load()
        input_ids = _encode(text, vocab)

        if input_ids.size == 0:
            return Audio(np.zeros(0, dtype=np.float32), _SAMPLE_RATE)

        batch = input_ids[np.newaxis, :]

        with self._lock:
            outputs = session.run(  # type: ignore[attr-defined]
                ["waveform"],
                {"input_ids": batch, "attention_mask": np.ones_like(batch)},
            )

        return Audio(outputs[0].squeeze(0).astype(np.float32), _SAMPLE_RATE)


def _normalize(text: str) -> str:
    """Lowercases and rewrites what the model's small alphabet cannot spell."""
    out: list[str] = []

    for char in text.lower():
        if char in _DIGITS:
            out.append(f" {_DIGITS[char]} ")
        else:
            out.append(_ENCODING_FIXES.get(char, _TRANSLITERATIONS.get(char, char)))

    return "".join(out)


def _encode(text: str, vocab: dict[str, int]) -> np.ndarray:
    """Characters to ids, with a blank between every pair.

    This mirrors `VitsTokenizer` with `add_blank=True`: unknown characters are
    dropped, and token id 0 is interleaved so the model sees the gaps the
    duration predictor was trained with.
    """
    ids = [vocab[char] for char in _normalize(text) if char in vocab]

    if not ids:
        return np.zeros(0, dtype=np.int64)

    interleaved = np.zeros(len(ids) * 2 + 1, dtype=np.int64)
    interleaved[1::2] = ids

    return interleaved
