"""Separation constants and the stem-label regex (no backends)."""

from sidecar import separation


def test_stem_regex_extracts_label():
    m = separation._STEM_RE.search("source_(Vocals)_htdemucs_ft.wav")
    assert m is not None
    assert m.group(1) == "Vocals"


def test_stem_regex_no_match_without_group():
    assert separation._STEM_RE.search("source.wav") is None


def test_default_engines_are_valid_ids():
    # Every default engine must exist in the full engine set.
    assert separation.DEFAULT_ENGINES
    assert all(e in separation.ENGINES for e in separation.DEFAULT_ENGINES)
