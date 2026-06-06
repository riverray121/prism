from typing import Literal

from pydantic import BaseModel

# Frontend -> sidecar commands.


class ImportCommand(BaseModel):
    type: Literal["library.import"]
    paths: list[str]


class ListCommand(BaseModel):
    type: Literal["library.list"]


class QueueAddCommand(BaseModel):
    type: Literal["queue.add"]
    song_ids: list[str]


class GetProfileCommand(BaseModel):
    type: Literal["profile.get"]
    song_id: str


# Sidecar -> frontend events.


class Song(BaseModel):
    id: str
    title: str
    artist: str
    duration_sec: float | None
    sample_rate: int | None
    source_path: str
    status: str
    imported_at: str


class LibrarySongsEvent(BaseModel):
    type: Literal["library.songs"] = "library.songs"
    songs: list[Song]


class ImportFailedEvent(BaseModel):
    type: Literal["library.import_failed"] = "library.import_failed"
    path: str
    error: str


class ProfileEvent(BaseModel):
    type: Literal["profile"] = "profile"
    song_id: str
    profile: dict
