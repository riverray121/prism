"""Amplitude extractors on synthetic signals."""

import numpy as np

from sidecar.features import amplitude


def test_rms_normalized_to_unit_range(sine, sr, hop):
    out = amplitude.rms(sine, sr, hop)
    assert out["render"] == "continuous"
    assert out["range"] == [0, 1]
    data = out["data"]
    assert data and max(data) <= 1.0 + 1e-6
    assert min(data) >= 0.0


def test_peak_sub_hop_signal_is_empty(sr, hop):
    # Fewer samples than one hop: no frame to measure.
    out = amplitude.peak(np.zeros(hop // 2, dtype=np.float32), sr, hop)
    assert out["data"] == []


def test_peak_normalized_to_unit_range(sine, sr, hop):
    data = amplitude.peak(sine, sr, hop)["data"]
    assert data and max(data) <= 1.0 + 1e-6


def test_loudness_floors_silence_at_minus_70(sr, hop):
    out = amplitude.loudness_lufs(np.zeros(sr, dtype=np.float32), sr, hop)
    assert out["unit"] == "LUFS"
    assert all(v == -70.0 for v in out["data"])


def test_loudness_of_tone_is_above_floor(sine, sr, hop):
    data = amplitude.loudness_lufs(sine, sr, hop)["data"]
    assert max(data) > -70.0


def test_silence_detects_a_long_gap(sr, hop):
    # Tone, then a 0.5 s silent gap (> MIN_SILENCE_SEC), then tone again.
    tone = 0.5 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)
    gap = np.zeros(sr // 2)
    y = np.concatenate([tone, gap, tone]).astype(np.float32)
    segments = amplitude.silence(y, sr, hop)["segments"]
    assert any(s["label"] == "silence" for s in segments)
    for s in segments:
        assert s["end"] - s["start"] >= amplitude.MIN_SILENCE_SEC


def test_dynamic_range_zeros_is_zero_db():
    out = amplitude.dynamic_range(np.zeros(1000, dtype=np.float32), 22050)
    assert out["render"] == "scalar"
    assert out["value"] == 0.0


def test_dynamic_range_positive_for_peaky_signal():
    # A single spike over quiet noise has a high crest factor.
    y = np.full(1000, 0.01, dtype=np.float32)
    y[500] = 1.0
    assert amplitude.dynamic_range(y, 22050)["value"] > 0.0
