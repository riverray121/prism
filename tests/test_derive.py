"""Default onset derivation (peak-pick over continuous features)."""

import numpy as np

from sidecar.features import derive


def _spiky(length=100, spikes=(10, 40, 80), height=1.0):
    y = np.zeros(length)
    for i in spikes:
        y[i] = height
    return y


def test_onsets_at_spike_positions():
    onsets = derive.onsets_from(_spiky(), frame_rate_hz=100.0)
    assert [o["t"] for o in onsets] == [0.1, 0.4, 0.8]
    assert all(o["strength"] == 1.0 for o in onsets)


def test_flat_signal_has_no_onsets():
    assert derive.onsets_from(np.ones(50), frame_rate_hz=100.0) == []


def test_peaks_below_cutoff_are_dropped():
    y = _spiky(spikes=(10,), height=1.0)
    y[40] = 0.2  # below the 0.3 default cutoff after normalization
    onsets = derive.onsets_from(y, frame_rate_hz=100.0)
    assert [o["t"] for o in onsets] == [0.1]


def test_min_separation_keeps_the_higher_peak():
    y = np.zeros(100)
    y[50] = 0.8
    y[53] = 1.0  # 30 ms later — inside the 100 ms separation window
    onsets = derive.onsets_from(y, frame_rate_hz=100.0)
    assert [o["t"] for o in onsets] == [0.53]


def test_strength_is_normalized_to_the_features_own_range():
    y = np.zeros(100)
    y[20] = 5.0
    y[60] = 10.0
    onsets = derive.onsets_from(y, frame_rate_hz=100.0)
    assert [o["strength"] for o in onsets] == [0.5, 1.0]


def test_attach_onsets_hits_only_continuous_envelopes():
    feature_map = {
        "rms": {"render": "continuous", "data": list(_spiky())},
        "beats": {"render": "event", "events": []},
    }
    derive.attach_onsets(feature_map, 100.0)
    assert len(feature_map["rms"]["onsets"]) == 3
    assert "onsets" not in feature_map["beats"]
