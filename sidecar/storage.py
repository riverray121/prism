"""Disk layout for the managed library.

One folder per song under ``library/songs/{uuid}/``. The library root lives at
the repo root during development; packaging will relocate it to the app data
dir (deferred). See ``docs/profile-schema.md`` for the full on-disk layout.
"""

import json
import shutil
from pathlib import Path
from uuid import uuid4

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


def write_profile(song: dict, *, bpm: float, analyzed_at: str) -> None:
    """Write profile.json for an analyzed song. M1 holds only the bpm feature.

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
        "mix": {
            "bpm": {
                "render": "scalar",
                "category": "rhythm",
                "source": "librosa.beat",
                "unit": "bpm",
                "value": bpm,
            }
        },
    }
    path = SONGS_DIR / song["id"] / "profile.json"
    path.write_text(json.dumps(profile, indent=2))
