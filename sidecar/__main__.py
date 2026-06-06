import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import library, metadata, storage
from .schema import (
    ImportCommand,
    ImportFailedEvent,
    LibrarySongsEvent,
    ListCommand,
    Song,
)

# Log to stderr so the stdout JSON-lines channel stays clean.
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("sidecar")


def emit(event: object) -> None:
    """Write one JSON-line event to stdout."""
    print(event.model_dump_json(), flush=True)  # type: ignore[attr-defined]


def library_snapshot() -> LibrarySongsEvent:
    """Read all rows and build a full library.songs event."""
    with library.connect() as con:
        rows = library.list_songs(con)
    songs = [Song(**dict(row)) for row in rows]
    return LibrarySongsEvent(songs=songs)


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
                emit(ImportFailedEvent(path=path_str, error=str(exc)))
        emit(library_snapshot())
    elif msg_type == "library.list":
        ListCommand.model_validate(msg)
        emit(library_snapshot())
    else:
        log.warning("unknown command: %r", msg)


def main() -> None:
    log.info("sidecar started")
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
