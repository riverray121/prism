"""Mapping-doc persistence against tmp_path (never the real library)."""

import json

import pytest

from sidecar import mapping, storage


@pytest.fixture
def library_root(tmp_path, monkeypatch):
    """Point storage's path globals at a throwaway library tree."""
    root = tmp_path / "library"
    songs = root / "songs"
    songs.mkdir(parents=True)
    monkeypatch.setattr(storage, "LIBRARY_ROOT", root)
    monkeypatch.setattr(storage, "SONGS_DIR", songs)
    return root


DOC = {
    "schema_version": "0.1.0",
    "derivations": [
        {
            "id": "kick_hits",
            "source": "stems.htdemucs_ft.drums.features.drums_energy",
            "threshold": {"cutoff": 0.4, "mode": "segments"},
        }
    ],
    "programs": [
        {
            "id": "kick_strobe",
            "enabled": True,
            "channels": {"gate": {"source": "derived.kick_hits"}, "hue": 0},
        }
    ],
    "macro": {"scenes_from": None, "scenes": {}, "master": None},
}


def test_write_read_round_trip(library_root):
    (library_root / "songs" / "s1").mkdir()
    mapping.write_mapping("s1", DOC)
    assert mapping.read_mapping("s1") == DOC


def test_read_missing_returns_none(library_root):
    (library_root / "songs" / "s1").mkdir()
    assert mapping.read_mapping("s1") is None


def test_write_creates_mapping_dir_and_is_atomic(library_root):
    song_dir = library_root / "songs" / "s1"
    song_dir.mkdir()
    mapping.write_mapping("s1", DOC)
    mapping_dir = song_dir / "mapping"
    assert (mapping_dir / "mapping.json").exists()
    # No temp files left behind by the atomic rename.
    assert [p.name for p in mapping_dir.iterdir()] == ["mapping.json"]


def test_write_replaces_existing(library_root):
    (library_root / "songs" / "s1").mkdir()
    mapping.write_mapping("s1", DOC)
    updated = dict(DOC, programs=[])
    mapping.write_mapping("s1", updated)
    assert mapping.read_mapping("s1")["programs"] == []


def test_read_corrupt_returns_none(library_root):
    song_dir = library_root / "songs" / "s1" / "mapping"
    song_dir.mkdir(parents=True)
    (song_dir / "mapping.json").write_text("{not json")
    assert mapping.read_mapping("s1") is None


def test_read_non_object_returns_none(library_root):
    song_dir = library_root / "songs" / "s1" / "mapping"
    song_dir.mkdir(parents=True)
    (song_dir / "mapping.json").write_text(json.dumps([1, 2]))
    assert mapping.read_mapping("s1") is None


def test_write_rejects_nan(library_root):
    (library_root / "songs" / "s1").mkdir()
    bad = dict(DOC, programs=[{"id": "p", "channels": {"hue": float("nan")}}])
    with pytest.raises(ValueError):
        mapping.write_mapping("s1", bad)
