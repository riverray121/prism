"""Disk layout for the managed library.

One folder per song under ``library/songs/{uuid}/``. The library root lives at
the repo root during development; packaging will relocate it to the app data
dir (deferred). See ``docs/profile-schema.md`` for the full on-disk layout.
"""

import json
import shutil
from pathlib import Path
from uuid import uuid4

import numpy as np

# Profile JSON schema version (see docs/profile-schema.md).
SCHEMA_VERSION = "0.1.0"

# Repo root is the parent of the ``sidecar`` package directory. Resolved from the
# module location so the path holds regardless of the process working directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
LIBRARY_ROOT = REPO_ROOT / "library"
SONGS_DIR = LIBRARY_ROOT / "songs"
DB_PATH = LIBRARY_ROOT / "library.db"


def import_file(source: Path) -> tuple[str, str]:
    """Copy ``source`` into a new per-song folder.

    Returns the assigned UUID and the copied file's path relative to the library
    root (e.g. ``songs/{uuid}/source.flac``), which is what the DB stores.
    """
    song_id = str(uuid4())
    dest_dir = SONGS_DIR / song_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"source{source.suffix.lower()}"
    shutil.copy2(source, dest)
    return song_id, str(dest.relative_to(LIBRARY_ROOT))


def write_profile(
    song: dict,
    *,
    analyzed_at: str,
    frame_rate_hz: float,
    frame_count: int,
    mix: dict[str, dict],
) -> None:
    """Write profile.json for an analyzed song.

    ``mix`` is the keyed map of feature envelopes (see docs/profile-schema.md);
    the worker assembles it and aligns every continuous feature to frame_count.
    Sidecar paths in the profile are relative to profile.json itself, so
    source_file is just the filename.
    """
    profile = {
        "schema_version": SCHEMA_VERSION,
        "song": {
            "id": song["id"],
            "title": song["title"],
            "artist": song["artist"],
            "duration_sec": song["duration_sec"],
            "sample_rate": song["sample_rate"],
            "source_file": Path(song["source_path"]).name,
            "imported_at": song["imported_at"],
            "analyzed_at": analyzed_at,
        },
        "timeline": {
            "frame_rate_hz": frame_rate_hz,
            "frame_count": frame_count,
        },
        "mix": mix,
    }
    path = SONGS_DIR / song["id"] / "profile.json"
    path.write_text(json.dumps(profile, indent=2))


def write_heatmap(song_id: str, name: str, matrix: np.ndarray) -> str:
    """Write a heatmap matrix as an uncompressed float32 .npy sidecar.

    Returns the path relative to profile.json (e.g. ``heatmaps/mfcc.npy``), which
    is what the feature's ``sidecar`` field stores.
    """
    rel = f"heatmaps/{name}.npy"
    path = SONGS_DIR / song_id / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Force C-order: some librosa features (e.g. chroma_cqt) return Fortran-order
    # arrays, and the frontend .npy parser only reads C-order.
    np.save(path, np.ascontiguousarray(matrix, dtype=np.float32))
    return rel


def read_profile(song_id: str) -> dict:
    """Read an analyzed song's profile.json. Raises FileNotFoundError if absent."""
    return json.loads((SONGS_DIR / song_id / "profile.json").read_text())
