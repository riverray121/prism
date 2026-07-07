"""Stereo-width extractor: mono, wide, and sub-hop cases."""

import numpy as np

from sidecar.features import spatial


def test_mono_source_has_zero_width(sine, sr, hop):
    out = spatial.stereo_width(sine, sr, hop)
    assert out["range"] == [0, 1]
    assert all(v == 0.0 for v in out["data"])


def test_hard_panned_stereo_has_positive_width(sr, hop):
    # Signal only in the left channel: maximal side content, so width > 0.
    t = np.arange(sr) / sr
    left = 0.5 * np.sin(2 * np.pi * 440 * t)
    right = np.zeros_like(left)
    stereo = np.stack([left, right]).astype(np.float32)
    data = spatial.stereo_width(stereo, sr, hop)["data"]
    assert max(data) > 0.0


def test_sub_hop_signal_is_empty(hop, sr):
    out = spatial.stereo_width(np.zeros(hop // 2, dtype=np.float32), sr, hop)
    assert out["data"] == []
