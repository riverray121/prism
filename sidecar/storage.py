"""Disk layout for the managed library.

One folder per song under ``library/songs/{uuid}/``. The library root lives at
the repo root during development; packaging will relocate it to the app data
dir (deferred). See ``docs/profile-schema.md`` for the full on-disk layout.
"""

import json
import os
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4

import numpy as np

# Profile JSON schema version (see docs/profile-schema.md).
# 0.2.0: optional `onsets` on continuous feature envelopes.
# 0.3.0: optional `onsets_strict` sibling (prominence-filtered maxima).
SCHEMA_VERSION = "0.3.0"

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
    stems: dict[str, dict] | None = None,
) -> None:
    """Write profile.json for an analyzed song.

    ``mix`` is the keyed map of feature envelopes (see docs/profile-schema.md);
    the worker assembles it and aligns every continuous feature to frame_count.
    ``stems`` is keyed by separation engine, then stem, each holding an
    ``audio_file`` path and a ``features`` map. Sidecar/audio paths in the profile
    are relative to profile.json itself, so source_file is just the filename.
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
        "stems": stems or {},
        # Re-analysis rewrites the profile wholesale; the user's stars survive
        # it (stale paths are the frontend's warn-only concern).
        "favorites": _existing_favorites(song["id"]),
    }
    write_json_atomic(SONGS_DIR / song["id"] / "profile.json", profile)


def _existing_favorites(song_id: str) -> list:
    try:
        favorites = read_profile(song_id).get("favorites", [])
        return favorites if isinstance(favorites, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def write_json_atomic(path: Path, obj: dict) -> None:
    # Write to a sibling temp file then atomically rename, so a kill/full disk
    # mid-write can't leave a truncated profile.json that read_profile chokes on.
    # allow_nan=False makes any non-finite leak fail loudly here rather than emit
    # non-standard JSON tokens.
    text = json.dumps(obj, indent=2, allow_nan=False)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w") as out:
            out.write(text)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def write_favorites(song_id: str, favorites: list[str]) -> None:
    """Replace the favorites list in an analyzed song's profile.json.

    Raises FileNotFoundError when the song has no profile (unanalyzed).
    """
    profile = read_profile(song_id)
    profile["favorites"] = favorites
    write_json_atomic(SONGS_DIR / song_id / "profile.json", profile)


def heatmap_rel(name: str) -> str:
    """Sidecar path for a heatmap, relative to profile.json — the single home
    of the ``heatmaps/{name}.npy`` convention."""
    return f"heatmaps/{name}.npy"


def heatmap_envelope(meta: dict, matrix: np.ndarray, sidecar: str) -> dict:
    """Build a heatmap feature envelope from its module's display metadata."""
    return {
        "render": "heatmap",
        "category": meta["category"],
        "source": "librosa",
        "unit": meta["unit"],
        "sidecar": sidecar,
        "shape": [int(matrix.shape[0]), int(matrix.shape[1])],
        "axes": meta["axes"],
    }


def write_heatmap(song_id: str, name: str, matrix: np.ndarray) -> str:
    """Write a heatmap matrix as an uncompressed float32 .npy sidecar.

    ``name`` may include a subdirectory for nesting (e.g. ``mfcc`` for a mix
    heatmap, ``htdemucs_ft/vocals_mfcc`` for a per-stem one). Returns the path
    relative to profile.json (e.g. ``heatmaps/mfcc.npy``), which is what the
    feature's ``sidecar`` field stores.
    """
    rel = heatmap_rel(name)
    path = SONGS_DIR / song_id / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Force C-order: some librosa features (e.g. chroma_cqt) return Fortran-order
    # arrays, and the frontend .npy parser only reads C-order.
    np.save(path, np.ascontiguousarray(matrix, dtype=np.float32))
    return rel


def cleanup_partial(song_id: str) -> None:
    """Remove partial analysis output for a failed song so a retry starts clean.

    Drops the whole ``stems/`` and ``heatmaps/`` trees. The mix pass rewrites the
    top-level heatmaps before separation on retry, so removing them costs nothing
    and avoids leaking sidecars for a never-retried failed song.
    """
    song_dir = SONGS_DIR / song_id
    shutil.rmtree(song_dir / "stems", ignore_errors=True)
    shutil.rmtree(song_dir / "heatmaps", ignore_errors=True)


def read_profile(song_id: str) -> dict:
    """Read an analyzed song's profile.json. Raises FileNotFoundError if absent."""
    return json.loads((SONGS_DIR / song_id / "profile.json").read_text())


def update_profile_metadata(song_id: str, title: str, artist: str) -> None:
    """Mirror a metadata edit into profile.json, when the song is analyzed."""
    try:
        profile = read_profile(song_id)
    except FileNotFoundError:
        return
    profile["song"]["title"] = title
    profile["song"]["artist"] = artist
    write_json_atomic(SONGS_DIR / song_id / "profile.json", profile)


def delete_song_dir(song_id: str) -> None:
    # Remove a song's whole folder (source, stems, heatmaps, profile).
    shutil.rmtree(SONGS_DIR / song_id, ignore_errors=True)
