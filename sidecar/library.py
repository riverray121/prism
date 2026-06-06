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
    analyzed_at            TEXT,
    error_message          TEXT
);
"""


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a connection to library.db, ensuring the library dir and schema exist."""
    storage.LIBRARY_ROOT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(storage.DB_PATH)
    con.row_factory = sqlite3.Row
    # WAL allows the worker thread to write while the UI reads, from M2 on.
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(_SCHEMA)
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
               status, imported_at
        FROM songs
        ORDER BY imported_at
        """
    ).fetchall()
