"""Shared fixtures: short synthetic signals so DSP tests need no real audio,
plus throwaway storage roots and in-memory DB connections (never library.db)."""

import sqlite3

import numpy as np
import pytest

from sidecar import library, storage


@pytest.fixture
def library_root(tmp_path, monkeypatch):
    """Point storage's path globals at a throwaway library tree."""
    root = tmp_path / "library"
    songs = root / "songs"
    songs.mkdir(parents=True)
    monkeypatch.setattr(storage, "LIBRARY_ROOT", root)
    monkeypatch.setattr(storage, "SONGS_DIR", songs)
    return root


@pytest.fixture
def con():
    """In-memory SQLite built from the real schema."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(library._SCHEMA + library._SETTINGS_SCHEMA)
    yield c
    c.close()


# Small enough that every extractor runs in well under a second.
SR = 22050
HOP = 220  # ~100 Hz frame rate at SR, matching the worker's target


@pytest.fixture
def sr() -> int:
    return SR


@pytest.fixture
def hop() -> int:
    return HOP


@pytest.fixture
def sine() -> np.ndarray:
    """1 s A440 sine at SR."""
    t = np.arange(SR) / SR
    return (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)


@pytest.fixture
def noise() -> np.ndarray:
    """1 s of deterministic white noise (fixed seed, no Math.random-style flakiness)."""
    rng = np.random.default_rng(0)
    return rng.standard_normal(SR).astype(np.float32) * 0.3
