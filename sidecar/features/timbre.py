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


def mfcc(y: np.ndarray, sr: int, hop: int, n_mfcc: int = 13) -> np.ndarray:
    """Timbre fingerprint: MFCC matrix of shape (n_mfcc, frames).

    Returned as a raw matrix (not an envelope) — heatmaps are written to a .npy
    sidecar by the worker, not stored inline in the profile.
    """
    return librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc, hop_length=hop)
