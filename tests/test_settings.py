"""Analysis-settings resolution (engines + drum sub-sep) over raw storage."""

import sqlite3

import pytest

from sidecar import library, separation, settings


@pytest.fixture
def con():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(library._SCHEMA + library._SETTINGS_SCHEMA)
    yield c
    c.close()


def test_get_engines_defaults_when_unset(con):
    assert settings.get_engines(con) == separation.DEFAULT_ENGINES


def test_get_engines_drops_invalid_ids_and_keeps_order(con):
    library.set_setting(con, "engines", ["bogus", "htdemucs_ft"])
    engines = settings.get_engines(con)
    assert "bogus" not in engines
    assert "htdemucs_ft" in engines
    # Result follows the canonical ENGINES order, not the saved order.
    assert engines == [e for e in separation.ENGINES if e in {"htdemucs_ft"}]


def test_get_engines_empty_selection_is_mix_only(con):
    library.set_setting(con, "engines", [])
    assert settings.get_engines(con) == []


def test_set_engines_validates_once_at_write(con):
    settings.set_engines(con, ["bogus", "htdemucs_ft"])
    # Raw storage holds only known ids — no re-validation needed on read.
    assert library.get_setting(con, "engines", None) == ["htdemucs_ft"]


def test_drum_subsep_round_trip_defaults_false(con):
    assert settings.get_drum_subsep(con) is False
    settings.set_drum_subsep(con, True)
    assert settings.get_drum_subsep(con) is True


def test_engine_info_covers_every_engine():
    assert set(separation.ENGINE_INFO) == set(separation.ENGINES)
