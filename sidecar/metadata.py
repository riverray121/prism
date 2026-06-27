"""Audio metadata extraction via mutagen.

Reads tags and technical info uniformly across FLAC, WAV, MP3, and AAC/M4A.
Title/artist precedence: file tags -> ``Artist - Title`` filename heuristic ->
filename with "Unknown" artist.
"""

from dataclasses import dataclass
from pathlib import Path

import mutagen


@dataclass
class TrackMetadata:
    title: str
    artist: str
    duration_sec: float | None
    sample_rate: int | None


def _first_tag(audio: mutagen.FileType, key: str) -> str | None:
    """Return the first value of an easy tag, or None if absent."""
    if audio.tags is None or key not in audio.tags:
        return None
    # easy=True normalizes every tag value to a list.
    value = audio.tags[key]
    return str(value[0]) if value else None


def _from_filename(path: Path) -> tuple[str, str]:
    """Split a ``Artist - Title`` stem; otherwise stem as title, Unknown artist."""
    stem = path.stem
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return title.strip(), artist.strip()
    return stem, "Unknown"


def extract(path: Path) -> TrackMetadata:
    # easy=True normalizes tag keys to 'title'/'artist' across formats. The
    # technical info (.info) is present regardless of tag format.
    audio = mutagen.File(path, easy=True)
    file_title = _first_tag(audio, "title") if audio is not None else None
    file_artist = _first_tag(audio, "artist") if audio is not None else None

    name_title, name_artist = _from_filename(path)
    title = file_title or name_title
    artist = file_artist or name_artist

    info = getattr(audio, "info", None)
    duration = getattr(info, "length", None)
    sample_rate = getattr(info, "sample_rate", None)

    return TrackMetadata(
        title=title,
        artist=artist,
        duration_sec=float(duration) if duration is not None else None,
        sample_rate=int(sample_rate) if sample_rate is not None else None,
    )
