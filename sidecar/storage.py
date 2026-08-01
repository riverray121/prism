"""Disk layout for the managed library.

One folder per song under ``library/songs/{uuid}/``. The library root lives at
the repo root during development; packaging will relocate it to the app data
dir (deferred). See ``docs/profile-schema.md`` for the full on-disk layout.
"""

import json
import logging
import os
import shutil
import tempfile
import threading
from pathlib import Path
from uuid import uuid4

import numpy as np

log = logging.getLogger("sidecar")

# Serializes profile.json read-modify-writes across threads: the worker rewrites
# the whole file (write_profile) while the main thread edits favorites/metadata
# in place. Without this, interleaved read→write pairs let the last rename
# silently revert the other thread's update.
_PROFILE_LOCK = threading.Lock()

# Profile JSON schema version (see docs/profile-schema.md).
# 0.2.0: optional `onsets` on continuous feature envelopes.
# 0.3.0: optional `onsets_strict` sibling (prominence-filtered maxima).
# 0.4.0: continuous `data` arrays move to .npy sidecars (`sidecar`/`frames`/
#        `data_range` replace inline `data`) — profile.json stays kilobytes.
SCHEMA_VERSION = "0.4.0"

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
    # Inline continuous arrays are what made profile.json tens of MB; every
    # consumer streams the .npy on demand instead (heatmaps' model).
    _extract_continuous(mix, song["id"], "features")
    for engine, engine_stems in (stems or {}).items():
        for stem_name, entry in engine_stems.items():
            _extract_continuous(
                entry["features"], song["id"], f"features/{engine}/{stem_name}"
            )
            for sub, sub_entry in entry.get("substems", {}).items():
                _extract_continuous(
                    sub_entry["features"],
                    song["id"],
                    f"features/{engine}/{stem_name}/{sub}",
                )

    with _PROFILE_LOCK:
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
            # Re-analysis rewrites the profile wholesale; the user's stars
            # survive it (stale paths are the frontend's warn-only concern).
            "favorites": _existing_favorites(song["id"]),
        }
        write_json_atomic(SONGS_DIR / song["id"] / "profile.json", profile)


def _extract_continuous(features: dict, song_id: str, prefix: str) -> None:
    """Move each continuous envelope's data array into a .npy sidecar.

    Replaces ``data`` with ``sidecar`` (path relative to profile.json),
    ``frames`` (sample count), and ``data_range`` ([min, max] — consumers like
    auto-map need the extent without loading the array). Derived onset lists
    stay inline (small). Mutates the envelopes in place.
    """
    for name, env in features.items():
        if env.get("render") != "continuous" or "data" not in env:
            continue
        arr = np.asarray(env.pop("data"), dtype=np.float32)
        rel = f"{prefix}/{name}.npy"
        path = SONGS_DIR / song_id / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, np.ascontiguousarray(arr))
        env["sidecar"] = rel
        env["frames"] = int(arr.shape[0])
        env["data_range"] = (
            [float(arr.min()), float(arr.max())] if arr.size else [0.0, 0.0]
        )


def migrate_profiles() -> int:
    """One-time startup upgrade of pre-0.4.0 profiles: extract inline
    continuous data to .npy sidecars and bump the schema version. Returns how
    many profiles were migrated. Unreadable profiles are left alone (the read
    path reports them)."""
    migrated = 0
    if not SONGS_DIR.exists():
        return 0
    for path in sorted(SONGS_DIR.glob("*/profile.json")):
        song_id = path.parent.name
        try:
            profile = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if profile.get("schema_version") == SCHEMA_VERSION:
            continue
        # One structurally drifted profile (stems as a list, a non-dict stem
        # entry) must not take down startup for every song — skip it, as with
        # unreadable files above.
        try:
            with _PROFILE_LOCK:
                _extract_continuous(profile.get("mix", {}), song_id, "features")
                for engine, engine_stems in profile.get("stems", {}).items():
                    for stem_name, entry in engine_stems.items():
                        _extract_continuous(
                            entry.get("features", {}),
                            song_id,
                            f"features/{engine}/{stem_name}",
                        )
                        for sub, sub_entry in entry.get("substems", {}).items():
                            _extract_continuous(
                                sub_entry.get("features", {}),
                                song_id,
                                f"features/{engine}/{stem_name}/{sub}",
                            )
                profile["schema_version"] = SCHEMA_VERSION
                write_json_atomic(path, profile)
        except Exception:
            log.exception("profile migration failed for %s", song_id)
            continue
        migrated += 1
    return migrated


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
            # Reach the disk before the rename, so a power loss can't leave a
            # truncated file behind the atomic replace.
            out.flush()
            os.fsync(out.fileno())
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def write_favorites(song_id: str, favorites: list[str]) -> None:
    """Replace the favorites list in an analyzed song's profile.json.

    Raises FileNotFoundError when the song has no profile (unanalyzed).
    """
    with _PROFILE_LOCK:
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
    shutil.rmtree(song_dir / "features", ignore_errors=True)


def read_profile(song_id: str) -> dict:
    """Read an analyzed song's profile.json. Raises FileNotFoundError if absent."""
    return json.loads((SONGS_DIR / song_id / "profile.json").read_text())


def update_profile_metadata(song_id: str, title: str, artist: str) -> None:
    """Mirror a metadata edit into profile.json, when the song is analyzed."""
    with _PROFILE_LOCK:
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
