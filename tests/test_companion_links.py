"""Companion request links: one per song, surfaced in the songs listing."""

from sidecar import library


def _insert(con, song_id):
    library.insert_song(
        con,
        song_id=song_id,
        title="t",
        artist="a",
        duration_sec=None,
        sample_rate=None,
        source_path=f"songs/{song_id}/source.flac",
        imported_at="2026-09-11T00:00:00+00:00",
    )


def test_link_round_trip_and_listing(con):
    _insert(con, "s1")
    _insert(con, "s2")
    library.link_request(con, "s1", "r1", {"spotify_uri": "spotify:track:x"})
    link = library.get_link(con, "s1")
    assert link == {
        "request_id": "r1",
        "external": {"spotify_uri": "spotify:track:x"},
        "published_at": None,
    }
    assert library.get_link(con, "s2") is None
    by_id = {row["id"]: row["request_id"] for row in library.list_songs(con)}
    assert by_id == {"s1": "r1", "s2": None}


def test_relink_replaces_and_publish_marks(con):
    _insert(con, "s1")
    library.link_request(con, "s1", "r1", {})
    library.link_request(con, "s1", "r2", {"k": "v"})
    library.mark_published(con, "s1", "2026-09-11T01:00:00+00:00")
    link = library.get_link(con, "s1")
    assert link["request_id"] == "r2"
    assert link["published_at"] == "2026-09-11T01:00:00+00:00"
