"""Headless library tool for the show-algorithm lab: fetch songs from YouTube
and analyze them into a library folder without the app.

    uv run python -m sidecar.lab --library eval-library fetch "Artist - Title" ...
    uv run python -m sidecar.lab --library eval-library analyze [--all-models]
    uv run python -m sidecar.lab --library eval-library list

``--library`` points every storage path at that folder, so the app's own
``library/`` is never read or written. ``analyze`` runs the same worker stages
as the app, one song at a time, until the queue is empty.
"""

import argparse
import logging
import shutil
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from . import library, metadata, separation, settings, storage, worker, youtube

log = logging.getLogger("sidecar.lab")


def _import_audio(path: Path, title: str, artist: str) -> str:
    song_id, source_path = storage.import_file(path)
    meta = metadata.extract(path)
    with library.connect() as con:
        library.insert_song(
            con,
            song_id=song_id,
            title=title,
            artist=artist,
            duration_sec=meta.duration_sec,
            sample_rate=meta.sample_rate,
            source_path=source_path,
            imported_at=datetime.now(UTC).isoformat(),
        )
    return song_id


def fetch(queries: list[str]) -> None:
    """Find, download, loudness-normalize and import each "Artist - Title"
    query, then queue it. A query already in the library (same artist and
    title) is skipped."""
    with library.connect() as con:
        have = {(r["artist"], r["title"]) for r in library.list_songs(con)}
    for query in queries:
        artist, _, title = query.partition(" - ")
        if not title:
            raise SystemExit(f'expected "Artist - Title", got {query!r}')
        if (artist, title) in have:
            log.info("already in library: %s", query)
            continue
        tmp = Path(tempfile.mkdtemp(prefix="prism-lab-"))
        try:
            url = youtube.find_source(artist, title, None, 1)
            audio = youtube.download(url, dest_dir=tmp)
            youtube.normalize_loudness(audio)
            song_id = _import_audio(audio, title, artist)
            with library.connect() as con:
                library.mark_queued(con, [song_id], datetime.now(UTC).isoformat())
            log.info("imported %s as %s from %s", query, song_id, url)
        except Exception:
            log.exception("fetch failed: %s", query)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def analyze(all_models: bool) -> None:
    with library.connect() as con:
        if all_models:
            settings.set_engines(con, list(separation.ENGINES))
            settings.set_drum_subsep(con, True)
        stuck = library.fail_interrupted(con, "interrupted")
        if stuck:
            library.mark_queued(con, stuck, datetime.now(UTC).isoformat())
    while (song := worker._claim_next()) is not None:
        log.info("analyzing %s - %s", song["artist"], song["title"])
        worker._process(song, lambda: None)


def list_songs() -> None:
    with library.connect() as con:
        for r in library.list_songs(con):
            print(f"{r['id']}  {r['status']:<10}  {r['artist']} - {r['title']}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="sidecar.lab")
    parser.add_argument("--library", type=Path, required=True)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_fetch = sub.add_parser("fetch")
    p_fetch.add_argument("queries", nargs="+")
    p_an = sub.add_parser("analyze")
    p_an.add_argument("--all-models", action="store_true")
    sub.add_parser("list")
    args = parser.parse_args(argv)

    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    storage.set_library_root(args.library.resolve())
    if args.cmd == "fetch":
        fetch(args.queries)
    elif args.cmd == "analyze":
        analyze(args.all_models)
    else:
        list_songs()


if __name__ == "__main__":
    main()
