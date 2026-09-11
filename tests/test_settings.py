"""Analysis-settings resolution (engines + drum sub-sep) over raw storage."""

from sidecar import library, separation, settings


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


def test_companion_defaults_to_empty(con):
    assert settings.get_companion(con) == ("", "")


def test_set_companion_strips_and_drops_trailing_slash(con):
    settings.set_companion(con, " http://192.168.8.2:8760/ ", " tok ")
    assert settings.get_companion(con) == ("http://192.168.8.2:8760", "tok")


def test_set_companion_none_leaves_field_unchanged(con):
    settings.set_companion(con, "http://a:1", "t1")
    settings.set_companion(con, None, "t2")
    assert settings.get_companion(con) == ("http://a:1", "t2")
    settings.set_companion(con, "", None)
    assert settings.get_companion(con) == ("", "t2")
