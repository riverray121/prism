"""Amplitude features (librosa)."""

import librosa
import numpy as np

# Target frame rate for continuous features. The actual rate is sr/hop_length,
# which rounds close to this; the exact value is returned for the timeline.
TARGET_FRAME_RATE_HZ = 100


def compute_rms(y: np.ndarray, sr: int) -> tuple[list[float], float]:
    """Volume envelope, peak-normalized to 0-1, sampled at ~100 Hz.

    Returns the per-frame values and the actual frame rate (sr/hop_length).
    """
    hop_length = max(1, round(sr / TARGET_FRAME_RATE_HZ))
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    peak = float(rms.max()) if rms.size else 0.0
    normalized = (rms / peak) if peak > 0 else rms
    return [float(x) for x in normalized], sr / hop_length
