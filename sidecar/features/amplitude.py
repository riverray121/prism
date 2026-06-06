"""Amplitude features (librosa / numpy).

Continuous features are sampled on the shared timeline hop the worker passes in,
so every continuous feature in a profile lines up frame-for-frame.
"""

import librosa
import numpy as np


def rms(y: np.ndarray, sr: int, hop: int) -> dict:
    """Volume envelope, peak-normalized to 0-1."""
    r = librosa.feature.rms(y=y, hop_length=hop)[0]
    peak = float(r.max()) if r.size else 0.0
    normalized = (r / peak) if peak > 0 else r
    return {
        "render": "continuous",
        "category": "amplitude",
        "source": "librosa",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in normalized],
    }


def peak(y: np.ndarray, sr: int, hop: int) -> dict:
    """Sample-peak envelope: max absolute sample per frame, normalized to 0-1."""
    frames = librosa.util.frame(y, frame_length=hop, hop_length=hop)
    p = np.abs(frames).max(axis=0) if frames.size else np.array([])
    top = float(p.max()) if p.size else 0.0
    normalized = (p / top) if top > 0 else p
    return {
        "render": "continuous",
        "category": "amplitude",
        "source": "numpy",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in normalized],
    }


def dynamic_range(y: np.ndarray, sr: int) -> dict:
    """Crest factor over the whole song in dB: ratio of peak to RMS amplitude."""
    rms_all = float(np.sqrt(np.mean(np.square(y)))) if y.size else 0.0
    peak_all = float(np.abs(y).max()) if y.size else 0.0
    crest_db = 20.0 * np.log10(peak_all / rms_all) if rms_all > 0 else 0.0
    return {
        "render": "scalar",
        "category": "amplitude",
        "source": "derived",
        "unit": "dB",
        "value": float(crest_db),
    }
