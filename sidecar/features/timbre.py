"""Timbre features (librosa)."""

import librosa
import numpy as np


def zero_crossing_rate(y: np.ndarray, hop: int) -> dict:
    """Noisiness: fraction of sign changes per frame (0-1)."""
    z = librosa.feature.zero_crossing_rate(y=y, hop_length=hop)[0]
    return {
        "render": "continuous",
        "category": "timbre",
        "source": "librosa",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in z],
    }
