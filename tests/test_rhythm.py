"""Rhythm extractors on synthetic click trains (wrapper behavior, not librosa)."""

import numpy as np
import pytest

from sidecar.features import rhythm
from tests.conftest import HOP, SR


def clicks(period_sec: float, seconds: float = 4.0) -> np.ndarray:
    """Impulse train: one unit spike every ``period_sec``."""
    y = np.zeros(int(SR * seconds), dtype=np.float32)
    step = int(SR * period_sec)
    y[::step] = 1.0
    return y


def test_onsets_finds_clicks_with_normalized_strengths():
    feat = rhythm.onsets(clicks(0.5), SR, HOP)
    assert feat["render"] == "event"
    times = [ev["t"] for ev in feat["events"]]
    # One onset near each click (detector may miss the very first/last edge).
    assert len(times) >= 6
    for t in times:
        assert min(abs(t - k * 0.5) for k in range(9)) < 0.06
    strengths = [ev["strength"] for ev in feat["events"]]
    assert all(0 < s <= 1.0 for s in strengths)


def test_onsets_empty_signal_has_no_events():
    feat = rhythm.onsets(np.zeros(SR, dtype=np.float32), SR, HOP)
    assert feat["events"] == []


def test_rhythmic_density_tracks_click_rate():
    dense = rhythm.rhythmic_density(clicks(0.25), SR, HOP)
    sparse = rhythm.rhythmic_density(clicks(1.0), SR, HOP)
    assert dense["render"] == "continuous"
    assert dense["unit"] == "onsets/sec"
    # 4 clicks/sec vs 1 click/sec: mid-signal density reflects the ratio.
    mid = slice(len(dense["data"]) // 4, 3 * len(dense["data"]) // 4)
    assert np.mean(dense["data"][mid]) > 2.5 * np.mean(sparse["data"][mid])


def test_rhythm_features_bpm_beats_and_downbeats_are_consistent():
    feats = rhythm.rhythm_features(clicks(0.5, seconds=8.0), SR)
    assert feats["bpm"]["render"] == "scalar"
    assert 40 <= feats["bpm"]["value"] <= 250

    beats = [ev["t"] for ev in feats["beats"]["events"]]
    assert len(beats) >= 8
    # Steady click train -> a steady beat grid.
    intervals = np.diff(beats)
    assert np.std(intervals) == pytest.approx(0, abs=0.05)

    downbeats = {ev["t"] for ev in feats["downbeats"]["events"]}
    assert downbeats.issubset(set(beats))
    # The 4/4 heuristic keeps roughly every fourth beat.
    ratio = len(beats) / max(1, len(downbeats))
    assert 3 <= ratio <= 5
