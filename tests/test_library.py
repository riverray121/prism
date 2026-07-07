"""Library queue/claim/cancel state machine and raw settings storage.

Runs against an in-memory SQLite built from the real schema — never library.db.
"""

import sqlite3

import pytest

from sidecar import library


@pytest.fixture
def con():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(library._SCHEMA + library._SETTINGS_SCHEMA)
    yield c
    c.close()


def _insert(con, song_id="s1"):
    library.insert_song(
        con,
        song_id=song_id,
        title="t",
        artist="a",
        duration_sec=1.0,
        sample_rate=44100,
        source_path=f"songs/{song_id}/source.flac",
        imported_at="2026-01-01T00:00:00Z",
    )


def _status(con, song_id):
    return con.execute("SELECT status FROM songs WHERE id=?", (song_id,)).fetchone()[0]


def test_insert_and_list(con):
    _insert(con)
    rows = library.list_songs(con)
    assert len(rows) == 1
    assert rows[0]["status"] == "unanalyzed"


def test_queue_and_next_queued(con):
    _insert(con)
    library.mark_queued(con, ["s1"], "2026-01-01T01:00:00Z")
    assert _status(con, "s1") == "queued"
    nxt = library.next_queued(con)
    assert nxt is not None and nxt["id"] == "s1"


def test_cancel_unanalyzed_restores_unanalyzed(con):
    _insert(con)
    library.mark_queued(con, ["s1"], "t")
    library.cancel_queued(con, "s1")
    assert _status(con, "s1") == "unanalyzed"


def test_cancel_reanalyzed_restores_analyzed(con):
    # A previously analyzed song re-queued then cancelled returns to 'analyzed'
    # (its profile still exists, analyzed_at is set).
    _insert(con)
    library.mark_queued(con, ["s1"], "t")
    library.mark_analyzing(con, "s1")
    library.mark_analyzed(con, "s1", "2026-01-02T00:00:00Z")
    library.mark_queued(con, ["s1"], "t2")
    library.cancel_queued(con, "s1")
    assert _status(con, "s1") == "analyzed"


def test_mark_analyzing_claim_is_exclusive(con):
    _insert(con)
    library.mark_queued(con, ["s1"], "t")
    assert library.mark_analyzing(con, "s1") is True  # won the claim
    assert library.mark_analyzing(con, "s1") is False  # already claimed


def test_cancel_cannot_touch_analyzing_song(con):
    _insert(con)
    library.mark_queued(con, ["s1"], "t")
    library.mark_analyzing(con, "s1")
    library.cancel_queued(con, "s1")  # guarded to status='queued'
    assert _status(con, "s1") == "analyzing"


def test_mark_failed_clears_analyzed_at(con):
    _insert(con)
    library.mark_queued(con, ["s1"], "t")
    library.mark_analyzing(con, "s1")
    library.mark_failed(con, "s1", "boom")
    row = con.execute(
        "SELECT status, error_message, analyzed_at FROM songs WHERE id=?", ("s1",)
    ).fetchone()
    assert row["status"] == "failed"
    assert row["error_message"] == "boom"
    assert row["analyzed_at"] is None


def test_fail_interrupted_returns_affected_ids(con):
    _insert(con, "s1")
    _insert(con, "s2")
    library.mark_queued(con, ["s1"], "t")
    library.mark_analyzing(con, "s1")  # s1 left mid-analysis
    ids = library.fail_interrupted(con, "interrupted")
    assert ids == ["s1"]
    assert _status(con, "s1") == "failed"
    assert _status(con, "s2") == "unanalyzed"  # untouched


def test_get_setting_falls_back_on_malformed_json(con):
    # External corruption of a stored value must not break resolution.
    con.execute("INSERT INTO settings (key, value) VALUES ('engines', 'not json')")
    assert library.get_setting(con, "engines", ["default"]) == ["default"]


def test_setting_round_trip(con):
    library.set_setting(con, "engines", ["htdemucs_ft"])
    assert library.get_setting(con, "engines", None) == ["htdemucs_ft"]
