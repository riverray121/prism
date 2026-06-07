"""Spatial features (derived from the stereo signal)."""

import librosa
import numpy as np


def stereo_width(y_stereo: np.ndarray, sr: int, hop: int) -> dict:
    """Stereo width over time, 0 (mono) to ~1 (wide), from the mid/side ratio.

    Per frame: width = RMS(side) / (RMS(mid) + RMS(side)), where mid = (L+R)/2 and
    side = (L-R)/2. A mono source has no side signal, so width is 0 throughout.
    """
    if y_stereo.ndim == 1:  # mono source: no stereo information
        left = right = y_stereo
    else:
        left, right = y_stereo[0], y_stereo[1]
    mid = (left + right) / 2.0
    side = (left - right) / 2.0

    def frame_rms(x: np.ndarray) -> np.ndarray:
        frames = librosa.util.frame(x, frame_length=hop, hop_length=hop)
        return np.sqrt(np.mean(frames**2, axis=0)) if frames.size else np.array([])

    mid_rms = frame_rms(mid)
    side_rms = frame_rms(side)
    width = side_rms / (mid_rms + side_rms + 1e-9)
    return {
        "render": "continuous",
        "category": "spatial",
        "source": "derived",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in width],
    }
