"""SQLite index of imported songs (``library.db``).

One row per song. Columns mirror the design doc's library index; M1 populates a
subset (the analysis-progress columns fill in from M2 on). Connections are
opened per operation so a worker thread can hold its own without sharing state.
"""

import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator

from . import storage

# Full column set per docs/design-doc.md. Progress/analysis columns are nullable
# and unused until later milestones.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id                     TEXT PRIMARY KEY,
    title                  TEXT NOT NULL,
    artist                 TEXT NOT NULL,
    duration_sec           REAL,
    sample_rate            INTEGER,
    source_path            TEXT NOT NULL,
    imported_at            TEXT NOT NULL,
    queued_at              TEXT,
    status                 TEXT NOT NULL DEFAULT 'unanalyzed',
    current_stage          TEXT,
    current_stage_progress REAL,
    current_engine         TEXT,
    analyzed_at            TEXT,
    error_message          TEXT
);
"""

# Columns added after the initial schema. Applied as non-destructive ALTERs so an
# existing dev DB gains them without a wipe (CREATE TABLE IF NOT EXISTS is a no-op
# on an existing table, so new columns must be added explicitly).
_ADDED_COLUMNS = {
    "current_engine": "TEXT",
}


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a connection to library.db, ensuring the library dir and schema exist."""
    storage.LIBRARY_ROOT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(storage.DB_PATH)
    con.row_factory = sqlite3.Row
    # WAL (worker writes while the UI reads) is a persistent DB property, so set
    # it once. Switching to WAL takes an exclusive lock and ignores busy_timeout,
    # so on a freshly created DB the worker and UI threads can collide on the
    # switch — only switch if it isn't already WAL, and tolerate a concurrent
    # setter winning the race.
    if con.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
        try:
            con.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError:
            pass
    con.execute(_SCHEMA)
    # Add any columns introduced after the initial schema to an existing table.
    existing = {row["name"] for row in con.execute("PRAGMA table_info(songs)")}
    for name, decl in _ADDED_COLUMNS.items():
        if name not in existing:
            con.execute(f"ALTER TABLE songs ADD COLUMN {name} {decl}")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def insert_song(
    con: sqlite3.Connection,
    *,
    song_id: str,
    title: str,
    artist: str,
    duration_sec: float | None,
    sample_rate: int | None,
    source_path: str,
    imported_at: str,
) -> None:
    con.execute(
        """
        INSERT INTO songs (id, title, artist, duration_sec, sample_rate,
                           source_path, imported_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'unanalyzed')
        """,
        (song_id, title, artist, duration_sec, sample_rate, source_path, imported_at),
    )


def list_songs(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute(
        """
        SELECT id, title, artist, duration_sec, sample_rate, source_path,
               status, imported_at, current_stage, current_stage_progress,
               current_engine
        FROM songs
        ORDER BY imported_at
        """
    ).fetchall()


def mark_queued(con: sqlite3.Connection, song_ids: list[str], queued_at: str) -> None:
    """Queue songs for analysis. Re-queues failed/unanalyzed rows; clears prior error."""
    con.executemany(
        """
        UPDATE songs
        SET status='queued', queued_at=?, error_message=NULL
        WHERE id=? AND status IN ('unanalyzed', 'failed')
        """,
        [(queued_at, song_id) for song_id in song_ids],
    )


def next_queued(con: sqlite3.Connection) -> sqlite3.Row | None:
    """Oldest queued song, or None. Columns cover what the worker needs to analyze."""
    return con.execute(
        """
        SELECT id, title, artist, duration_sec, sample_rate, source_path, imported_at
        FROM songs
        WHERE status='queued'
        ORDER BY queued_at
        LIMIT 1
        """
    ).fetchone()


def mark_analyzing(con: sqlite3.Connection, song_id: str) -> None:
    con.execute("UPDATE songs SET status='analyzing' WHERE id=?", (song_id,))


def mark_stage(
    con: sqlite3.Connection,
    song_id: str,
    stage: str,
    progress: float,
    engine: str | None = None,
) -> None:
    """Record the worker's current stage, 0-1 progress, and engine (if any).

    The snapshot reads these so the UI stays a pure function of song rows. ``engine``
    is the separation engine currently running, or None for non-separation stages.
    """
    con.execute(
        """
        UPDATE songs
        SET current_stage=?, current_stage_progress=?, current_engine=?
        WHERE id=?
        """,
        (stage, progress, engine, song_id),
    )


def mark_analyzed(con: sqlite3.Connection, song_id: str, analyzed_at: str) -> None:
    con.execute(
        """
        UPDATE songs
        SET status='analyzed', analyzed_at=?,
            current_stage=NULL, current_stage_progress=NULL, current_engine=NULL
        WHERE id=?
        """,
        (analyzed_at, song_id),
    )


def mark_failed(con: sqlite3.Connection, song_id: str, error_message: str) -> None:
    con.execute(
        """
        UPDATE songs
        SET status='failed', error_message=?,
            current_stage=NULL, current_stage_progress=NULL, current_engine=NULL
        WHERE id=?
        """,
        (error_message, song_id),
    )


def fail_interrupted(con: sqlite3.Connection, error_message: str) -> list[str]:
    """Mark any row left 'analyzing' as failed; return the affected song ids.

    Called at sidecar startup: a row stuck in 'analyzing' means a prior run crashed
    or was quit mid-analysis (now common — separation is long-running). Failing it
    avoids a crash loop and lets the user retry explicitly.
    """
    ids = [
        row["id"]
        for row in con.execute("SELECT id FROM songs WHERE status='analyzing'")
    ]
    if ids:
        con.execute(
            """
            UPDATE songs
            SET status='failed', error_message=?,
                current_stage=NULL, current_stage_progress=NULL, current_engine=NULL
            WHERE status='analyzing'
            """,
            (error_message,),
        )
    return ids
