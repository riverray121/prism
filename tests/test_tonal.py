"""Tonal extractors and the key-detection helper."""

import numpy as np

from sidecar.features import tonal


def test_best_key_recovers_c_major_from_its_own_profile():
    # Correlating the C-major profile with itself is the strongest possible match.
    name, corr = tonal._best_key(tonal._MAJOR)
    assert name == "C major"
    assert corr > 0.99


def test_best_key_nan_guard_on_constant_chroma():
    # A flat chroma yields NaN correlations everywhere; the guard must still
    # return a finite fallback rather than a NaN "best".
    name, corr = tonal._best_key(np.ones(12))
    assert isinstance(name, str)
    assert np.isfinite(corr) or corr == -2.0


def test_key_confidence_clamped_to_unit_range(sine, sr):
    _, conf = tonal.key(sine, sr)
    assert 0.0 <= conf["value"] <= 1.0


def test_tuning_deviation_near_zero_for_a440(sr):
    t = np.arange(sr) / sr
    a440 = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    cents = tonal.tuning_deviation(a440, sr)["value"]
    assert abs(cents) < 50.0  # within a quarter-tone of concert pitch
