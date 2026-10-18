"""On-disk cache for synthesised lines.

Rehearsing means hearing the same scene many times, so the second run of a
scene should cost no CPU at all. The key is the voice plus the exact text, and
because audio is always produced at natural speed, changing the rehearsal speed
does not invalidate anything.

The cache is a plain directory, not Redis: the entries are hundreds of
kilobytes each, they survive restarts for free, and the service is the only
reader.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from pathlib import Path

logger = logging.getLogger("osvald.tts.cache")


class AudioCache:
    """A size-capped directory of WAV files."""

    def __init__(self, directory: Path, max_bytes: int) -> None:
        self._dir = directory
        self._max_bytes = max_bytes
        self._lock = threading.Lock()
        self._dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(voice_id: str, text: str) -> str:
        digest = hashlib.sha256(f"{voice_id}\x00{text}".encode()).hexdigest()
        return digest[:32]

    def _path(self, key: str) -> Path:
        return self._dir / f"{key}.wav"

    def get(self, key: str) -> bytes | None:
        path = self._path(key)

        try:
            data = path.read_bytes()
        except OSError:
            return None

        # Touch so eviction keeps what is actually being rehearsed.
        try:
            path.touch()
        except OSError:
            pass

        return data

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)

        try:
            # Write-then-rename: a reader must never see a half-written file.
            staging = path.with_suffix(".part")
            staging.write_bytes(data)
            staging.replace(path)
        except OSError:
            logger.warning("could not write cache entry %s", key, exc_info=True)
            return

        self._evict()

    def _evict(self) -> None:
        """Drops the least recently used entries once over the size cap."""
        with self._lock:
            entries = []
            total = 0

            for path in self._dir.glob("*.wav"):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                entries.append((stat.st_mtime, stat.st_size, path))
                total += stat.st_size

            if total <= self._max_bytes:
                return

            for _, size, path in sorted(entries):
                try:
                    path.unlink()
                except OSError:
                    continue
                total -= size
                if total <= self._max_bytes:
                    break
