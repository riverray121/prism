"""Vibrato derivation from a hand-built pitch contour (no pYIN)."""

import numpy as np

from sidecar.features import pitch

FRAME_RATE = 100.0


def test_vibrato_unvoiced_frames_zero_out():
    # All-NaN (unvoiced) contour: both rate and depth must be zero everywhere.
    f0 = np.full(200, np.nan)
    rate, depth = pitch.vibrato(f0, FRAME_RATE)
    assert all(v == 0.0 for v in rate["data"])
    assert all(v == 0.0 for v in depth["data"])


def test_vibrato_detects_oscillation():
    # A 6 Hz, 50-cent wobble around a steady pitch should read as non-zero depth
    # and a rate in a plausible vibrato band.
    n = 400
    t = np.arange(n) / FRAME_RATE
    f0 = 1200.0 + 50.0 * np.sin(2 * np.pi * 6.0 * t)
    rate, depth = pitch.vibrato(f0, FRAME_RATE)
    assert max(depth["data"]) > 0.0
    assert max(rate["data"]) > 0.0
    assert rate["unit"] == "hz" and depth["unit"] == "cents"
