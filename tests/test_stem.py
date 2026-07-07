"""Per-stem feature wiring: stem-type branching and timeline alignment.

The underlying extractors are faked — the wrapper's routing (which features per
stem type) and frame_count truncation are what this module owns.
"""

import numpy as np
import pytest

from sidecar.features import stem
from tests.conftest import HOP, SR


def _continuous(n: int) -> dict:
    return {"render": "continuous", "data": [0.5] * n}


@pytest.fixture
def faked_extractors(monkeypatch):
    """Replace every extractor stem_features calls with cheap deterministic fakes."""
    monkeypatch.setattr(stem.amplitude, "rms", lambda y, sr, hop: _continuous(10))
    monkeypatch.setattr(
        stem.frequency, "spectral_centroid", lambda spectrum, sr: _continuous(10)
    )
    monkeypatch.setattr(
        stem.rhythm,
        "onsets",
        lambda y, sr, hop: {"render": "event", "events": [{"t": 9.9}]},
    )
    monkeypatch.setattr(
        stem.timbre, "transient_sharpness", lambda y, sr, hop: _continuous(10)
    )
    monkeypatch.setattr(
        stem.timbre, "mfcc", lambda y, sr, hop: np.zeros((13, 10), dtype=np.float32)
    )
    monkeypatch.setattr(
        stem.pitch,
        "pitch",
        lambda y, sr, hop: (np.zeros(10), _continuous(10), _continuous(10)),
    )
    monkeypatch.setattr(
        stem.pitch,
        "vibrato",
        lambda f0_cents, frame_rate: (_continuous(10), _continuous(10)),
    )


def _run(stem_name: str):
    y = np.zeros(SR // 2, dtype=np.float32)
    return stem.stem_features(y, SR, HOP, frame_count=5, stem_name=stem_name)


def test_drums_get_no_pitch(faked_extractors):
    features, _ = _run("drums")
    assert set(features) == {
        "energy",
        "spectral_centroid",
        "onsets",
        "transient_sharpness",
    }


def test_melodic_stem_gets_pitch_but_not_vibrato(faked_extractors):
    features, _ = _run("bass")
    assert "pitch" in features and "pitch_confidence" in features
    assert "vibrato_rate" not in features


def test_vocals_get_vibrato(faked_extractors):
    features, _ = _run("vocals")
    assert "vibrato_rate" in features and "vibrato_depth" in features


def test_drum_substems_are_percussion(faked_extractors):
    features, _ = _run("kick")
    assert "pitch" not in features


def test_alignment_truncates_continuous_and_heatmaps_but_not_events(
    faked_extractors,
):
    features, heatmaps = _run("vocals")
    for f in features.values():
        if f["render"] == "continuous":
            assert len(f["data"]) == 5
    assert heatmaps["mfcc"].shape == (13, 5)
    # Events carry absolute times; alignment must leave them alone.
    assert features["onsets"]["events"] == [{"t": 9.9}]
