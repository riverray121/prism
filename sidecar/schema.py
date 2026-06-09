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
    # Multi-stage analysis progress (null unless status='analyzing').
    current_stage: str | None = None
    current_stage_progress: float | None = None
    # Separation engine currently running, during the separate/dsp-stem stages.
    current_engine: str | None = None


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
    # Absolute path to the source audio, for the frontend's asset-protocol URL.
    # Runtime-only (machine-specific), so kept out of profile.json.
    audio_path: str
    # Absolute path to the song folder, for resolving sidecar paths (heatmap
    # .npy files) against the profile's relative sidecar fields.
    song_dir: str
