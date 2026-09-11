"""Companion publishing: pack a song into a show bundle and upload it.

The bundle layout is docs/companion-api.md. Frames come from
``songs/{id}/show/frames`` (written by the shell from the frontend's render);
``project/`` mirrors the song folder minus the audio and the stems.
"""

import json
import logging
import shutil
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from . import library, settings, storage

log = logging.getLogger(__name__)

# Song-folder entries that never enter ``project/``: the audio ships at the
# bundle root, stems are separated audio the player has no use for, and
# ``show/`` is the frames staging folder.
_PROJECT_EXCLUDE = {"stems", "show"}


def pack(song_id: str, manifest: dict, dest: Path) -> None:
    """Write the show bundle zip for ``song_id`` to ``dest``."""
    song_dir = storage.SONGS_DIR / song_id
    audio_name = manifest["audio"]
    frames_dir = song_dir / "show" / "frames"
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        source = song_dir / manifest["source_file"]
        zf.write(source, audio_name, compress_type=zipfile.ZIP_STORED)
        for light in manifest["lights"]:
            key = light["key"]
            zf.write(frames_dir / f"{key}.bin", light["frames"])
        for path in sorted(song_dir.rglob("*")):
            rel = path.relative_to(song_dir)
            if not path.is_file() or rel.parts[0] in _PROJECT_EXCLUDE:
                continue
            if rel.name == source.name and len(rel.parts) == 1:
                continue
            zf.write(path, f"project/{rel.as_posix()}")


def _request(method: str, url: str, token: str, **kwargs) -> dict:
    req = urllib.request.Request(url, method=method, **kwargs)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            return json.load(res)
    except urllib.error.HTTPError as exc:
        try:
            message = json.load(exc).get("error") or f"HTTP {exc.code}"
        except (ValueError, AttributeError):
            message = f"HTTP {exc.code}"
        raise RuntimeError(message) from exc


def upload(url: str, token: str, show_id: str, bundle: Path) -> dict:
    """PUT the bundle; returns the companion's show summary."""
    size = bundle.stat().st_size
    with bundle.open("rb") as f:
        return _request(
            "PUT",
            f"{url}/v1/shows/{show_id}",
            token,
            data=f,
            headers={"Content-Type": "application/zip", "Content-Length": str(size)},
        )


def publish(song_id: str, manifest: dict) -> dict:
    """Pack, upload, and (when the song came from a request) mark the request
    published. Returns the show summary; raises with a user-facing message."""
    with library.connect() as con:
        url, token = settings.get_companion(con)
        link = library.get_link(con, song_id)
    if url == "":
        raise RuntimeError("no companion configured")
    manifest = dict(manifest)
    manifest["source_file"] = Path(manifest["source_file"]).name
    if link is not None:
        manifest["external"] = {**link["external"], **manifest.get("external", {})}
    tmp = Path(tempfile.mkdtemp(prefix="prism-show-"))
    try:
        bundle = tmp / "show.zip"
        pack(song_id, manifest, bundle)
        show = upload(url, token, song_id, bundle)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if link is not None:
        _request(
            "PATCH",
            f"{url}/v1/requests/{link['request_id']}",
            token,
            data=json.dumps({"status": "published", "show_id": song_id}).encode(),
            headers={"Content-Type": "application/json"},
        )
    with library.connect() as con:
        library.mark_published(con, song_id, datetime.now(UTC).isoformat())
    return show
