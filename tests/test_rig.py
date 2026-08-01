"""Rig-doc persistence against tmp_path (never the real library)."""

import json

from sidecar import rig, storage

RIG = {
    "hubs": [
        {
            "mac": "a842e39b1c60",
            "name": "Desk hub",
            "ip": "192.168.0.84",
            "lights": [{"id": "a842e39b1c60:0", "name": "Strip", "pixel_count": 300}],
        }
    ]
}


def test_write_read_round_trip(library_root):
    rig.write_rig(RIG)
    assert rig.read_rig() == RIG


def test_read_missing_returns_empty_rig(library_root):
    assert rig.read_rig() == {"hubs": []}


def test_write_is_atomic(library_root):
    rig.write_rig(RIG)
    # No temp files left behind by the atomic rename.
    assert not list(library_root.glob("*.tmp"))
    assert (library_root / "rig.json").exists()


def test_write_creates_library_dir(tmp_path, monkeypatch):
    root = tmp_path / "library"
    monkeypatch.setattr(storage, "LIBRARY_ROOT", root)
    rig.write_rig(RIG)
    assert rig.read_rig() == RIG


def test_write_replaces_existing(library_root):
    rig.write_rig(RIG)
    rig.write_rig({"hubs": []})
    assert rig.read_rig() == {"hubs": []}


def test_read_corrupt_returns_empty_rig(library_root):
    (library_root / "rig.json").write_text("{not json")
    assert rig.read_rig() == {"hubs": []}


def test_read_non_object_returns_empty_rig(library_root):
    (library_root / "rig.json").write_text(json.dumps([1, 2]))
    assert rig.read_rig() == {"hubs": []}
