"""IPC pydantic models: validation, discriminators, defaults, serialization."""

import json

import pytest
from pydantic import ValidationError

from sidecar import schema


def test_import_command_requires_paths():
    cmd = schema.ImportCommand(type="library.import", paths=["a.flac"])
    assert cmd.paths == ["a.flac"]
    with pytest.raises(ValidationError):
        schema.ImportCommand(type="library.import")  # missing paths


def test_command_type_literal_enforced():
    # A wrong discriminator value is rejected, not silently accepted.
    with pytest.raises(ValidationError):
        schema.QueueCancelCommand(type="queue.add", song_id="x")


def test_update_settings_partial_defaults_none():
    cmd = schema.UpdateSettingsCommand(type="settings.update")
    assert cmd.engines is None and cmd.drum_subsep is None


def test_song_optional_progress_defaults_none():
    song = schema.Song(
        id="1",
        title="t",
        artist="a",
        duration_sec=None,
        sample_rate=None,
        source_path="p",
        status="unanalyzed",
        imported_at="now",
    )
    assert song.current_stage is None
    assert song.current_engine is None
    assert song.current_step is None
    assert song.total_steps is None


def test_event_type_defaults_and_serialization():
    ev = schema.LibrarySongsEvent(songs=[])
    dumped = json.loads(ev.model_dump_json())
    assert dumped == {"type": "library.songs", "songs": []}


def test_settings_event_round_trips():
    ev = schema.SettingsEvent(
        engines=["htdemucs_ft"],
        available_engines=["htdemucs_ft"],
        engine_info={"htdemucs_ft": {"label": "Demucs", "drums": True}},
        drum_subsep=True,
    )
    dumped = json.loads(ev.model_dump_json())
    assert dumped["type"] == "settings"
    assert dumped["drum_subsep"] is True
