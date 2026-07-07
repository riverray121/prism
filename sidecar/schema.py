from typing import Literal

from pydantic import BaseModel

# Frontend -> sidecar commands.


class ImportCommand(BaseModel):
    type: Literal["library.import"]
    paths: list[str]


class QueueAddCommand(BaseModel):
    type: Literal["queue.add"]
    song_ids: list[str]


class QueueCancelCommand(BaseModel):
    type: Literal["queue.cancel"]
    song_id: str


class GetProfileCommand(BaseModel):
    type: Literal["profile.get"]
    song_id: str


class UpdateFavoritesCommand(BaseModel):
    type: Literal["favorites.update"]
    song_id: str
    # Full replacement list of dot-paths into the song's profile.
    favorites: list[str]


class UpdateSettingsCommand(BaseModel):
    type: Literal["settings.update"]
    # Partial update: each field is applied only if present.
    # Separation engine ids selected for analysis (subset of available engines).
    engines: list[str] | None = None
    # Whether to sub-separate drums stems into kick/snare/etc.
    drum_subsep: bool | None = None


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
    # Separation engine currently running, during the separate/dsp-stem stages.
    current_engine: str | None = None
    # Discrete progress: engine ``current_step`` of ``total_steps`` (no percentage —
    # the separation backends expose no intra-step progress).
    current_step: int | None = None
    total_steps: int | None = None


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


class EngineInfo(BaseModel):
    # Human-readable engine label for the UI.
    label: str
    # Whether the engine emits a `drums` stem (drum sub-separation capability).
    drums: bool


class SettingsEvent(BaseModel):
    type: Literal["settings"] = "settings"
    # Engine ids currently selected for analysis.
    engines: list[str]
    # All engine ids the sidecar can run, so the UI can render the full toggle set.
    available_engines: list[str]
    # Per-engine labels/capabilities, so the frontend hard-codes nothing.
    engine_info: dict[str, EngineInfo]
    # Whether drums stems are sub-separated into kick/snare/etc.
    drum_subsep: bool
