import json
import logging
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import ipc, library, metadata, storage, worker
from .schema import (
    GetProfileCommand,
    ImportCommand,
    ImportFailedEvent,
    LibrarySongsEvent,
    ListCommand,
    ProfileEvent,
    QueueAddCommand,
    Song,
)

# Log to stderr so the stdout JSON-lines channel stays clean.
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("sidecar")


def library_snapshot() -> LibrarySongsEvent:
    """Read all rows and build a full library.songs event."""
    with library.connect() as con:
        rows = library.list_songs(con)
    songs = [Song(**dict(row)) for row in rows]
    return LibrarySongsEvent(songs=songs)


def emit_snapshot() -> None:
    ipc.emit(library_snapshot())


def import_one(path_str: str) -> None:
    """Copy a file into the library and insert its row. Raises on failure."""
    source = Path(path_str)
    meta = metadata.extract(source)
    song_id, source_path = storage.import_file(source)
    with library.connect() as con:
        library.insert_song(
            con,
            song_id=song_id,
            title=meta.title,
            artist=meta.artist,
            duration_sec=meta.duration_sec,
            sample_rate=meta.sample_rate,
            source_path=source_path,
            imported_at=datetime.now(timezone.utc).isoformat(),
        )
    log.info("imported %s as %s", source.name, song_id)


def handle(msg: dict) -> None:
    msg_type = msg.get("type")
    log.info("command: %s", msg_type)
    if msg_type == "library.import":
        cmd = ImportCommand.model_validate(msg)
        for path_str in cmd.paths:
            try:
                import_one(path_str)
            except Exception as exc:
                log.exception("import failed: %s", path_str)
                ipc.emit(ImportFailedEvent(path=path_str, error=str(exc)))
        emit_snapshot()
    elif msg_type == "library.list":
        ListCommand.model_validate(msg)
        emit_snapshot()
    elif msg_type == "queue.add":
        cmd = QueueAddCommand.model_validate(msg)
        with library.connect() as con:
            library.mark_queued(
                con, cmd.song_ids, datetime.now(timezone.utc).isoformat()
            )
        emit_snapshot()  # reflect 'queued'; the worker picks up from here
    elif msg_type == "profile.get":
        cmd = GetProfileCommand.model_validate(msg)
        try:
            profile = storage.read_profile(cmd.song_id)
            audio_path = str(
                storage.SONGS_DIR / cmd.song_id / profile["song"]["source_file"]
            )
            ipc.emit(
                ProfileEvent(
                    song_id=cmd.song_id, profile=profile, audio_path=audio_path
                )
            )
        except FileNotFoundError:
            log.warning("no profile for %s", cmd.song_id)
    else:
        log.warning("unknown command: %r", msg)


def main() -> None:
    log.info("sidecar started")
    # Background worker drains the analysis queue while this thread reads stdin.
    threading.Thread(target=worker.run, args=(emit_snapshot,), daemon=True).start()
    # Read one JSON command per line from stdin; write one JSON event per line to stdout.
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            log.warning("invalid JSON: %r", line)
            continue
        handle(msg)
    log.info("sidecar stdin closed, exiting")


if __name__ == "__main__":
    main()
