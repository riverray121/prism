"""Metadata extraction: filename heuristic, tag reading, and precedence."""

from pathlib import Path
from types import SimpleNamespace

from sidecar import metadata


def test_from_filename_splits_artist_title():
    title, artist = metadata._from_filename(Path("/m/Daft Punk - Aerodynamic.flac"))
    assert title == "Aerodynamic"
    assert artist == "Daft Punk"


def test_from_filename_bare_stem_is_unknown_artist():
    title, artist = metadata._from_filename(Path("/m/track01.wav"))
    assert title == "track01"
    assert artist == "Unknown"


def test_first_tag_reads_and_handles_absence():
    audio = SimpleNamespace(tags={"title": ["Real Title"]})
    assert metadata._first_tag(audio, "title") == "Real Title"
    assert metadata._first_tag(audio, "artist") is None  # key absent
    assert metadata._first_tag(SimpleNamespace(tags=None), "title") is None


def test_extract_prefers_file_tags_over_filename(monkeypatch):
    fake = SimpleNamespace(
        tags={"title": ["Tagged"], "artist": ["Tagged Artist"]},
        info=SimpleNamespace(length=200.0, sample_rate=48000),
    )
    monkeypatch.setattr(metadata.mutagen, "File", lambda path, easy=True: fake)
    md = metadata.extract(Path("/m/Filename Artist - Filename Title.flac"))
    assert md.title == "Tagged"  # tag wins over filename
    assert md.artist == "Tagged Artist"
    assert md.duration_sec == 200.0
    assert md.sample_rate == 48000


def test_extract_falls_back_to_filename_when_untagged(monkeypatch):
    # mutagen returns None for an unreadable/untagged file: use the filename.
    monkeypatch.setattr(metadata.mutagen, "File", lambda path, easy=True: None)
    md = metadata.extract(Path("/m/Artist - Title.mp3"))
    assert md.title == "Title"
    assert md.artist == "Artist"
    assert md.duration_sec is None
    assert md.sample_rate is None
