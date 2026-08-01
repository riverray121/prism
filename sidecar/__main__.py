import json
import logging
import shutil
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path

from . import (
    ipc,
    library,
    logs,
    mapping,
    metadata,
    rig,
    separation,
    settings,
    storage,
    worker,
    youtube,
)
from .schema import (
    DeleteSongCommand,
    GetMappingCommand,
    GetProfileCommand,
    ImportCommand,
    ImportFailedEvent,
    ImportFinishedEvent,
    ImportStartedEvent,
    ImportYoutubeCommand,
    LibrarySongsEvent,
    MappingEvent,
    ProfileEvent,
    QueueAddCommand,
    QueueCancelCommand,
    RigEvent,
    SettingsEvent,
    Song,
    UpdateFavoritesCommand,
    UpdateMappingCommand,
    UpdateMetadataCommand,
    UpdateRigCommand,
    UpdateSettingsCommand,
)

# stderr keeps the stdout JSON-lines channel clean; logs.configure also mirrors
# every record to a rotated file and installs the crash hooks.
logs.configure()
log = logging.getLogger("sidecar")


def library_snapshot() -> LibrarySongsEvent:
    """Read all rows and build a full library.songs event."""
    with library.connect() as con:
        rows = library.list_songs(con)
    songs = [Song(**dict(row)) for row in rows]
    return LibrarySongsEvent(songs=songs)


def emit_snapshot() -> None:
    ipc.emit(library_snapshot())


def emit_settings() -> None:
    """Emit the current analysis settings (engines + drum sub-separation)."""
    with library.connect() as con:
        engines = settings.get_engines(con)
        drum_subsep = settings.get_drum_subsep(con)
    ipc.emit(
        SettingsEvent(
            engines=engines,
            available_engines=list(separation.ENGINES),
            engine_info=separation.ENGINE_INFO,
            drum_subsep=drum_subsep,
        )
    )


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
            imported_at=datetime.now(UTC).isoformat(),
        )
    log.info("imported %s as %s", source.name, song_id)


def import_youtube(url: str) -> None:
    """Download a URL's audio then run the normal import; emits its own events.

    Runs on a worker thread: downloads take long enough that holding the stdin
    command loop would freeze every other interaction. ipc.emit is lock-guarded,
    so emitting from here is safe.
    """
    tmp: Path | None = None
    ipc.emit(ImportStartedEvent(path=url))
    try:
        audio = youtube.download(url)
        tmp = audio.parent
        import_one(str(audio))
    except Exception as exc:
        log.exception("youtube import failed: %s", url)
        ipc.emit(ImportFailedEvent(path=url, error=str(exc)))
    finally:
        if tmp is not None:
            shutil.rmtree(tmp, ignore_errors=True)
        ipc.emit(ImportFinishedEvent(path=url))
    emit_snapshot()


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
    elif msg_type == "library.import_youtube":
        cmd = ImportYoutubeCommand.model_validate(msg)
        threading.Thread(target=import_youtube, args=(cmd.url,), daemon=True).start()
    elif msg_type == "library.list":
        emit_snapshot()
    elif msg_type == "queue.add":
        cmd = QueueAddCommand.model_validate(msg)
        with library.connect() as con:
            library.mark_queued(con, cmd.song_ids, datetime.now(UTC).isoformat())
        emit_snapshot()  # reflect 'queued'; the worker picks up from here
    elif msg_type == "queue.cancel":
        cmd = QueueCancelCommand.model_validate(msg)
        with library.connect() as con:
            library.cancel_queued(con, cmd.song_id)
        emit_snapshot()
    elif msg_type == "profile.get":
        cmd = GetProfileCommand.model_validate(msg)
        try:
            profile = storage.read_profile(cmd.song_id)
            song_dir = storage.SONGS_DIR / cmd.song_id
            audio_path = str(song_dir / profile["song"]["source_file"])
            ipc.emit(
                ProfileEvent(
                    song_id=cmd.song_id,
                    profile=profile,
                    audio_path=audio_path,
                    song_dir=str(song_dir),
                )
            )
        except FileNotFoundError:
            log.warning("no profile for %s", cmd.song_id)
        except (KeyError, TypeError, json.JSONDecodeError):
            # A schema-drifted or partially-written profile (missing keys, bad
            # JSON) shouldn't take down the command channel — log and skip.
            log.warning("malformed profile for %s", cmd.song_id)
    elif msg_type == "library.delete":
        cmd = DeleteSongCommand.model_validate(msg)
        with library.connect() as con:
            deleted = library.delete_song(con, cmd.song_id)
        if deleted:
            storage.delete_song_dir(cmd.song_id)
        else:
            log.warning("delete refused (analyzing?): %s", cmd.song_id)
        emit_snapshot()
    elif msg_type == "library.update_metadata":
        cmd = UpdateMetadataCommand.model_validate(msg)
        with library.connect() as con:
            library.update_metadata(con, cmd.song_id, cmd.title, cmd.artist)
        storage.update_profile_metadata(cmd.song_id, cmd.title, cmd.artist)
        emit_snapshot()
    elif msg_type == "favorites.update":
        cmd = UpdateFavoritesCommand.model_validate(msg)
        try:
            storage.write_favorites(cmd.song_id, cmd.favorites)
        except FileNotFoundError:
            log.warning("favorites for song without profile: %s", cmd.song_id)
    elif msg_type == "mapping.get":
        cmd = GetMappingCommand.model_validate(msg)
        doc = mapping.read_mapping(cmd.song_id)
        ipc.emit(MappingEvent(song_id=cmd.song_id, doc=doc if doc is not None else {}))
    elif msg_type == "mapping.update":
        cmd = UpdateMappingCommand.model_validate(msg)
        mapping.write_mapping(cmd.song_id, cmd.doc)
    elif msg_type == "rig.get":
        ipc.emit(RigEvent(rig=rig.read_rig()))
    elif msg_type == "rig.update":
        cmd = UpdateRigCommand.model_validate(msg)
        rig.write_rig(cmd.rig)
    elif msg_type == "settings.get":
        emit_settings()
    elif msg_type == "settings.update":
        cmd = UpdateSettingsCommand.model_validate(msg)
        with library.connect() as con:
            if cmd.engines is not None:
                settings.set_engines(con, cmd.engines)
            if cmd.drum_subsep is not None:
                settings.set_drum_subsep(con, cmd.drum_subsep)
        emit_settings()
    else:
        log.warning("unknown command: %r", msg)


def main() -> None:
    log.info("sidecar started")
    # Any row left 'analyzing' is from a run that crashed or was quit mid-analysis
    # (now common — separation is long-running). Fail it so it isn't retried in a
    # loop; the user can re-queue explicitly.
    with library.connect() as con:
        interrupted = library.fail_interrupted(con, "Analysis interrupted")
    if interrupted:
        log.info("marked %d interrupted song(s) as failed", len(interrupted))
    # Upgrade any pre-0.4.0 profile before serving commands, so the frontend
    # only ever sees the sidecar-backed format (its loader has no legacy path).
    migrated = storage.migrate_profiles()
    if migrated:
        log.info(
            "migrated %d profile(s) to schema %s", migrated, storage.SCHEMA_VERSION
        )
    emit_settings()  # let the UI render the analysis-settings panel on connect
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
        # One malformed/failing command (schema ValidationError, an unguarded DB
        # OperationalError, a KeyError on a drifted profile) must not terminate the
        # stdin loop and sever the whole command channel — log it and keep reading.
        try:
            handle(msg)
        except Exception:
            log.exception("command failed: %r", msg.get("type"))
    log.info("sidecar stdin closed, exiting")


if __name__ == "__main__":
    main()
