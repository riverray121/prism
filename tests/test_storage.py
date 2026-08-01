"""Disk-layout logic against tmp_path (never the real library)."""

import numpy as np
import pytest

from sidecar import storage


def _song(song_id="s1"):
    return {
        "id": song_id,
        "title": "Title",
        "artist": "Artist",
        "duration_sec": 12.3,
        "sample_rate": 44100,
        "source_path": "songs/s1/source.flac",
        "imported_at": "2026-01-01T00:00:00Z",
    }


def test_write_read_profile_round_trip(library_root):
    (library_root / "songs" / "s1").mkdir()
    storage.write_profile(
        _song(),
        analyzed_at="2026-01-02T00:00:00Z",
        frame_rate_hz=100.0,
        frame_count=5,
        mix={"rms": {"render": "continuous", "data": [0.1, 0.2]}},
    )
    profile = storage.read_profile("s1")
    assert profile["schema_version"] == storage.SCHEMA_VERSION
    assert profile["song"]["source_file"] == "source.flac"  # basename only
    assert profile["stems"] == {}  # defaults to empty when omitted
    assert profile["timeline"]["frame_count"] == 5


def test_write_profile_extracts_continuous_to_npy(library_root):
    (library_root / "songs" / "s1").mkdir()
    storage.write_profile(
        _song(),
        analyzed_at="2026-01-02T00:00:00Z",
        frame_rate_hz=100.0,
        frame_count=3,
        mix={
            "rms": {"render": "continuous", "data": [0.1, 0.5, 0.2]},
            "bpm": {"render": "scalar", "value": 120.0},
        },
        stems={
            "eng": {
                "drums": {
                    "audio_file": "stems/eng/drums.wav",
                    "features": {
                        "energy": {"render": "continuous", "data": [0.0, 1.0]}
                    },
                    "substems": {
                        "kick": {
                            "audio_file": "stems/eng/drums/kick.wav",
                            "features": {
                                "energy": {
                                    "render": "continuous",
                                    "data": [0.3, 0.4],
                                }
                            },
                        }
                    },
                }
            }
        },
    )
    profile = storage.read_profile("s1")
    rms = profile["mix"]["rms"]
    # Inline data replaced by the sidecar reference + extent.
    assert "data" not in rms
    assert rms["sidecar"] == "features/rms.npy"
    assert rms["frames"] == 3
    assert rms["data_range"] == [pytest.approx(0.1), pytest.approx(0.5)]
    loaded = np.load(library_root / "songs" / "s1" / rms["sidecar"])
    assert loaded.dtype == np.float32
    assert np.allclose(loaded, [0.1, 0.5, 0.2])
    # Scalars untouched.
    assert profile["mix"]["bpm"]["value"] == 120.0
    # Stem + substem features land in nested feature dirs.
    stem = profile["stems"]["eng"]["drums"]["features"]["energy"]
    assert stem["sidecar"] == "features/eng/drums/energy.npy"
    sub = profile["stems"]["eng"]["drums"]["substems"]["kick"]["features"]["energy"]
    assert sub["sidecar"] == "features/eng/drums/kick/energy.npy"
    assert (library_root / "songs" / "s1" / sub["sidecar"]).exists()


def test_migrate_profiles_upgrades_inline_data(library_root):
    import json

    song_dir = library_root / "songs" / "s1"
    song_dir.mkdir()
    # A pre-0.4.0 profile with inline continuous arrays at both levels.
    (song_dir / "profile.json").write_text(
        json.dumps(
            {
                "schema_version": "0.3.0",
                "song": {"id": "s1"},
                "mix": {
                    "rms": {"render": "continuous", "data": [0.2, 0.6]},
                    "beats": {"render": "event", "events": []},
                },
                "stems": {
                    "eng": {
                        "bass": {
                            "audio_file": "stems/eng/bass.wav",
                            "features": {
                                "energy": {
                                    "render": "continuous",
                                    "data": [0.1, 0.9],
                                }
                            },
                        }
                    }
                },
            }
        )
    )
    assert storage.migrate_profiles() == 1
    profile = storage.read_profile("s1")
    assert profile["schema_version"] == storage.SCHEMA_VERSION
    rms = profile["mix"]["rms"]
    assert "data" not in rms
    assert rms["sidecar"] == "features/rms.npy"
    assert (song_dir / "features" / "rms.npy").exists()
    stem = profile["stems"]["eng"]["bass"]["features"]["energy"]
    assert stem["sidecar"] == "features/eng/bass/energy.npy"
    # Events untouched; a second run is a no-op.
    assert profile["mix"]["beats"] == {"render": "event", "events": []}
    assert storage.migrate_profiles() == 0


def test_write_profile_rejects_nan(library_root):
    (library_root / "songs" / "s1").mkdir()
    with pytest.raises(ValueError):
        storage.write_profile(
            _song(),
            analyzed_at="x",
            frame_rate_hz=100.0,
            frame_count=1,
            mix={"bad": {"value": float("nan")}},
        )


def test_read_profile_missing_raises(library_root):
    with pytest.raises(FileNotFoundError):
        storage.read_profile("does-not-exist")


def test_write_heatmap_coerces_c_order_float32(library_root):
    (library_root / "songs" / "s1").mkdir()
    # A Fortran-order float64 matrix must be saved as C-order float32.
    matrix = np.asfortranarray(np.arange(6, dtype=np.float64).reshape(2, 3))
    rel = storage.write_heatmap("s1", "mfcc", matrix)
    assert rel == "heatmaps/mfcc.npy"
    loaded = np.load(library_root / "songs" / "s1" / rel)
    assert loaded.dtype == np.float32
    assert loaded.flags["C_CONTIGUOUS"]
    assert np.allclose(loaded, matrix)


def test_import_file_lowercases_suffix_and_returns_rel_path(library_root, tmp_path):
    source = tmp_path / "Song.FLAC"
    source.write_bytes(b"fake audio")
    song_id, rel = storage.import_file(source)
    assert rel == f"songs/{song_id}/source.flac"  # suffix lowercased
    assert (library_root / rel).read_bytes() == b"fake audio"


def test_cleanup_partial_is_idempotent(library_root):
    # No stems/heatmaps present yet: must not raise.
    storage.cleanup_partial("never-analyzed")


def _write_minimal_profile(analyzed_at="2026-01-02T00:00:00Z"):
    storage.write_profile(
        _song(),
        analyzed_at=analyzed_at,
        frame_rate_hz=100.0,
        frame_count=1,
        mix={},
    )


def test_write_favorites_round_trip(library_root):
    (library_root / "songs" / "s1").mkdir()
    _write_minimal_profile()
    assert storage.read_profile("s1")["favorites"] == []  # fresh profile default
    storage.write_favorites(
        "s1", ["mix.rms", "stems.htdemucs_ft.drums.features.drums_energy"]
    )
    assert storage.read_profile("s1")["favorites"] == [
        "mix.rms",
        "stems.htdemucs_ft.drums.features.drums_energy",
    ]


def test_write_favorites_without_profile_raises(library_root):
    with pytest.raises(FileNotFoundError):
        storage.write_favorites("does-not-exist", ["mix.rms"])


def test_reanalysis_preserves_favorites(library_root):
    (library_root / "songs" / "s1").mkdir()
    _write_minimal_profile()
    storage.write_favorites("s1", ["mix.rms"])
    _write_minimal_profile(analyzed_at="2026-01-03T00:00:00Z")  # re-analysis rewrite
    assert storage.read_profile("s1")["favorites"] == ["mix.rms"]


def test_delete_song_dir_removes_everything(library_root):
    song_dir = library_root / "songs" / "s1"
    (song_dir / "stems").mkdir(parents=True)
    (song_dir / "profile.json").write_text("{}")
    storage.delete_song_dir("s1")
    assert not song_dir.exists()
    storage.delete_song_dir("s1")  # idempotent
