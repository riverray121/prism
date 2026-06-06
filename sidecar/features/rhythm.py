"""Rhythm features (librosa)."""

import librosa
import numpy as np


def compute_bpm(y: np.ndarray, sr: int) -> float:
    """Estimate global tempo in BPM from a mono signal."""
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    # beat_track returns tempo as an array; take the scalar.
    return float(np.atleast_1d(tempo)[0])
