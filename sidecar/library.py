"""SQLite index of imported songs (``library.db``).

One row per song. Columns mirror the design doc's library index; M1 populates a
subset (the analysis-progress columns fill in from M2 on). Connections are
opened per operation so a worker thread can hold its own without sharing state.
"""

import json
import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator

from . import storage

# Identity, import metadata, analysis status, and per-stage progress. Progress
# columns are nullable — populated only while a song is analyzing.
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
    current_engine         TEXT,
    current_step           INTEGER,
    total_steps            INTEGER,
    analyzed_at            TEXT,
    error_message          TEXT
);
"""

# Key-value store for global app settings (e.g. selected analysis engines).
_SETTINGS_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# Columns added after the initial schema. Applied as non-destructive ALTERs so an
# existing dev DB gains them without a wipe (CREATE TABLE IF NOT EXISTS is a no-op
# on an existing table, so new columns must be added explicitly).
_ADDED_COLUMNS = {
    "current_engine": "TEXT",
    "current_step": "INTEGER",
    "total_steps": "INTEGER",
}

# Nulls every in-progress column. Shared by the terminal transitions so adding a
# progress column can't leave a stale value at one site.
_CLEAR_PROGRESS = (
    "current_stage=NULL, current_engine=NULL, current_step=NULL, total_steps=NULL"
)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a connection to library.db, ensuring the library dir and schema exist."""
    storage.LIBRARY_ROOT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(storage.DB_PATH)
    con.row_factory = sqlite3.Row
    # Under WAL two writers still serialize; with the default busy_timeout of 0 the
    # second writer fails instantly with 'database is locked'. The worker writes
    # frequently (per-stage) while the main thread writes on import/queue/settings,
    # so wait instead of failing. (This does not cover the WAL-switch below, which
    # takes an exclusive lock and ignores busy_timeout — handled separately.)
    con.execute("PRAGMA busy_timeout=5000")
    # WAL (worker writes while the UI reads) is a persistent DB property, so set
    # it once. The WAL switch takes an exclusive lock and ignores busy_timeout, so
    # on a freshly created DB the worker and UI threads can collide on the switch —
    # only switch if it isn't already WAL, and tolerate a concurrent setter winning
    # the race.
    if con.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
        try:
            con.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError:
            pass
    con.execute(_SCHEMA)
    con.execute(_SETTINGS_SCHEMA)
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
               status, imported_at, current_stage, current_engine,
               current_step, total_steps, error_message
        FROM songs
        ORDER BY imported_at
        """
    ).fetchall()


def mark_queued(con: sqlite3.Connection, song_ids: list[str], queued_at: str) -> None:
    """Queue songs for analysis; clears prior error. Analyzed songs may be
    re-queued (the worker overwrites their profile); analyzing/queued may not."""
    con.executemany(
        """
        UPDATE songs
        SET status='queued', queued_at=?, error_message=NULL
        WHERE id=? AND status IN ('unanalyzed', 'failed', 'analyzed')
        """,
        [(queued_at, song_id) for song_id in song_ids],
    )


def cancel_queued(con: sqlite3.Connection, song_id: str) -> None:
    """Remove a queued song from the queue, restoring its pre-queue status.

    A song re-queued from 'analyzed' (its profile.json still exists, analyzed_at
    set) returns to 'analyzed'; a never-analyzed song returns to 'unanalyzed'.
    Guarded to ``status='queued'`` so it can't cancel a song the worker has already
    claimed (status='analyzing') — a running song must finish (see design doc); the
    WHERE also resolves the claim race (the worker flips queued→analyzing atomically).
    """
    con.execute(
        """
        UPDATE songs
        SET status = CASE WHEN analyzed_at IS NOT NULL THEN 'analyzed'
                          ELSE 'unanalyzed' END,
            queued_at = NULL
        WHERE id=? AND status='queued'
        """,
        (song_id,),
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


def mark_analyzing(con: sqlite3.Connection, song_id: str) -> bool:
    """Atomically claim a queued song for analysis. Guarded to ``status='queued'``
    so it can't resurrect a row a concurrent ``cancel_queued`` already moved out of
    the queue. Returns True if this call won the claim (a row was updated)."""
    cur = con.execute(
        "UPDATE songs SET status='analyzing' WHERE id=? AND status='queued'",
        (song_id,),
    )
    return cur.rowcount > 0


def mark_stage(
    con: sqlite3.Connection,
    song_id: str,
    stage: str,
    *,
    engine: str | None = None,
    step: int | None = None,
    total: int | None = None,
) -> None:
    """Record the worker's current stage, engine, and discrete step (k of total).

    The snapshot reads these so the UI stays a pure function of song rows. Progress
    is reported as a step count (engine k of total), not a percentage — the
    separation backends expose no intra-step progress. ``engine``/``step``/``total``
    are None for non-separation stages (e.g. dsp-mix).
    """
    con.execute(
        """
        UPDATE songs
        SET current_stage=?, current_engine=?, current_step=?, total_steps=?
        WHERE id=?
        """,
        (stage, engine, step, total, song_id),
    )


def mark_analyzed(con: sqlite3.Connection, song_id: str, analyzed_at: str) -> None:
    con.execute(
        f"""
        UPDATE songs
        SET status='analyzed', analyzed_at=?, {_CLEAR_PROGRESS}
        WHERE id=?
        """,
        (analyzed_at, song_id),
    )


def mark_failed(con: sqlite3.Connection, song_id: str, error_message: str) -> None:
    # Clear analyzed_at: a failed run leaves no complete profile, so a later
    # cancel-after-requeue must not restore this row to 'analyzed' (cleanup_partial
    # has dropped its stems/heatmaps). analyzed_at is the authoritative "complete
    # profile exists" flag.
    con.execute(
        f"""
        UPDATE songs
        SET status='failed', error_message=?, analyzed_at=NULL, {_CLEAR_PROGRESS}
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
            f"""
            UPDATE songs
            SET status='failed', error_message=?, analyzed_at=NULL, {_CLEAR_PROGRESS}
            WHERE status='analyzing'
            """,
            (error_message,),
        )
    return ids


# --- Settings (key-value JSON store) ---------------------------------------


def get_setting(con: sqlite3.Connection, key: str, default=None):
    """Return a JSON-decoded setting value, or ``default`` if unset.

    Falls back to ``default`` on a malformed/empty stored value so external
    corruption can't break engine/drum-subsep resolution.
    """
    row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except (json.JSONDecodeError, TypeError):
        return default


def set_setting(con: sqlite3.Connection, key: str, value) -> None:
    """Upsert a JSON-encoded setting value."""
    con.execute(
        """
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
        """,
        (key, json.dumps(value)),
    )


def update_metadata(
    con: sqlite3.Connection, song_id: str, title: str, artist: str
) -> None:
    """Edit a song's user-facing metadata."""
    con.execute(
        "UPDATE songs SET title=?, artist=? WHERE id=?",
        (title, artist, song_id),
    )
