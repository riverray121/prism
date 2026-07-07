"""Timbre extractors on synthetic signals."""

import numpy as np

from sidecar.features import timbre


def test_zcr_higher_for_noise_than_tone(sine, noise, hop):
    tone_zcr = np.mean(timbre.zero_crossing_rate(sine, hop)["data"])
    noise_zcr = np.mean(timbre.zero_crossing_rate(noise, hop)["data"])
    assert noise_zcr > tone_zcr


def test_zcr_in_unit_range(noise, hop):
    out = timbre.zero_crossing_rate(noise, hop)
    assert out["range"] == [0, 1]
    assert all(0.0 <= v <= 1.0 for v in out["data"])


def test_mfcc_shape(sine, sr, hop):
    m = timbre.mfcc(sine, sr, hop, n_mfcc=13)
    assert m.shape[0] == 13
    assert m.ndim == 2
