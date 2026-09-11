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

from . import library, metadata, settings, storage

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
        manifest["request_id"] = link["request_id"]
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


def download(url: str, token: str, show_id: str, dest: Path) -> None:
    """GET the show bundle into ``dest``."""
    req = urllib.request.Request(f"{url}/v1/shows/{show_id}/bundle")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=600) as res, dest.open("wb") as out:
            shutil.copyfileobj(res, out)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}") from exc


def restore(show_id: str, bundle: Path) -> dict:
    """Unpack a bundle into the library under ``show_id``: the audio becomes
    ``source.<ext>``, ``project/`` replaces the song folder's profile, sidecars
    and mapping, and the song row is created or marked analyzed. Returns the
    manifest."""
    song_dir = storage.SONGS_DIR / show_id
    with zipfile.ZipFile(bundle) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        if manifest.get("schema") != "prism-show/1":
            raise RuntimeError(f"unknown bundle schema {manifest.get('schema')!r}")
        audio_name = manifest["audio"]
        ext = Path(audio_name).suffix.lower()
        staging = Path(tempfile.mkdtemp(prefix="prism-pull-"))
        try:
            for member in zf.namelist():
                if member == audio_name:
                    target = staging / f"source{ext}"
                elif member.startswith("project/") and not member.endswith("/"):
                    target = staging / member[len("project/") :]
                else:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            for entry in staging.iterdir():
                dest = song_dir / entry.name
                if dest.is_dir():
                    shutil.rmtree(dest)
                elif dest.exists():
                    dest.unlink()
                song_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(entry), str(dest))
        finally:
            shutil.rmtree(staging, ignore_errors=True)
    source = song_dir / f"source{ext}"
    now = datetime.now(UTC).isoformat()
    with library.connect() as con:
        if library.get_metadata(con, show_id) is None:
            meta = metadata.extract(source)
            library.insert_song(
                con,
                song_id=show_id,
                title=manifest["title"],
                artist=manifest["artist"],
                duration_sec=meta.duration_sec,
                sample_rate=meta.sample_rate,
                source_path=str(source.relative_to(storage.LIBRARY_ROOT)),
                imported_at=now,
            )
        if (song_dir / "profile.json").exists():
            library.mark_analyzed(con, show_id, now)
        if manifest.get("request_id"):
            library.link_request(
                con, show_id, manifest["request_id"], manifest.get("external", {})
            )
            library.mark_published(con, show_id, now)
    return manifest


def pull(show_id: str) -> dict:
    """Download a published show and restore it into the library."""
    with library.connect() as con:
        url, token = settings.get_companion(con)
    if url == "":
        raise RuntimeError("no companion configured")
    tmp = Path(tempfile.mkdtemp(prefix="prism-show-"))
    try:
        bundle = tmp / "show.zip"
        download(url, token, show_id, bundle)
        return restore(show_id, bundle)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
