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


def transient_sharpness(y: np.ndarray, sr: int, hop: int) -> dict:
    """Attack sharpness over time: the onset-strength envelope, normalized 0-1.

    A proxy for how percussive/sharp the attacks are at each moment — high during
    crisp hits, low during sustained or smooth passages.
    """
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    peak = float(env.max()) if env.size else 0.0
    norm = env / peak if peak > 0 else env
    return {
        "render": "continuous",
        "category": "timbre",
        "source": "librosa.onset",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in norm],
    }


def mfcc(y: np.ndarray, sr: int, hop: int, n_mfcc: int = 13) -> np.ndarray:
    """Timbre fingerprint: MFCC matrix of shape (n_mfcc, frames).

    Returned as a raw matrix (not an envelope) — heatmaps are written to a .npy
    sidecar by the worker, not stored inline in the profile.
    """
    return librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc, hop_length=hop)


# Display metadata for this module's heatmap feature; the profile writer builds
# the envelope from it so no other layer hard-codes it.
MFCC_HEATMAP = {
    "category": "timbre",
    "unit": "coefficient",
    "axes": ["mfcc", "time_frame"],
}
