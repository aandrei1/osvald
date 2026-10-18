"""Tests for the on-disk audio cache."""

from __future__ import annotations

from pathlib import Path

from app.cache import AudioCache


def test_the_key_is_stable_and_voice_specific() -> None:
    first = AudioCache.key("piper:amy", "Bună ziua.")

    assert first == AudioCache.key("piper:amy", "Bună ziua.")
    assert first != AudioCache.key("piper:mihai", "Bună ziua.")
    assert first != AudioCache.key("piper:amy", "Bună seara.")
    assert len(first) == 32


def test_put_and_get_round_trip(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path, max_bytes=1024)
    key = AudioCache.key("piper:amy", "Bună ziua.")

    assert cache.get(key) is None

    cache.put(key, b"audio-bytes")

    assert cache.get(key) == b"audio-bytes"
    # The staging file must be renamed into place, never left behind.
    assert list(tmp_path.glob("*.part")) == []


def test_evicts_entries_until_the_size_cap_is_respected(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path, max_bytes=12)

    for index in range(5):
        cache.put(f"key-{index}", b"0123456789")  # 10 bytes each

    remaining = list(tmp_path.glob("*.wav"))
    assert len(remaining) <= 1
    assert sum(path.stat().st_size for path in remaining) <= 12


def test_a_missing_entry_is_a_cache_miss(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path, max_bytes=1024)

    assert cache.get("does-not-exist") is None
