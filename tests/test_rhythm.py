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


def bar_clicks(seconds: float = 12.0, period_sec: float = 0.5) -> np.ndarray:
    """4/4 bars at 120 BPM: a noise click on every beat, plus a 60 Hz kick on
    each bar's first beat so the bar start is audible."""
    y = np.zeros(int(SR * seconds), dtype=np.float32)
    step = int(SR * period_sec)
    t = np.arange(int(0.08 * SR)) / SR
    kick = 0.9 * np.sin(2 * np.pi * 60 * t) * np.exp(-t * 30)
    for k, i in enumerate(range(0, len(y) - len(t), step)):
        if k % 4 == 0:
            y[i : i + len(t)] += kick
        y[i : i + 200] += np.random.default_rng(k).normal(
            0, 0.6 if k % 4 == 0 else 0.3, 200
        )
    return y


def test_rhythm_features_bpm_beats_and_downbeats_are_consistent():
    feats = rhythm.rhythm_features(bar_clicks(), SR)
    assert feats["bpm"]["render"] == "scalar"
    assert feats["bpm"]["value"] == pytest.approx(120, abs=2)

    beats = [ev["t"] for ev in feats["beats"]["events"]]
    assert len(beats) >= 20
    # Steady click train -> a steady beat grid.
    intervals = np.diff(beats)
    assert np.std(intervals) == pytest.approx(0, abs=0.05)

    downbeats = [ev["t"] for ev in feats["downbeats"]["events"]]
    assert set(downbeats).issubset(set(beats))
    # Bar starts land on the kicks, every 2 s (the clip's last edge may add one).
    assert len(downbeats) >= 5
    assert np.median(np.diff(downbeats)) == pytest.approx(2.0, abs=0.06)


def test_snap_downbeats_moves_each_to_its_nearest_beat():
    beats = np.array([0.0, 0.5, 1.0, 1.5, 2.0])
    snapped = rhythm._snap_downbeats(beats, np.array([0.02, 1.97]))
    assert snapped.tolist() == [0.0, 2.0]
