"""Rhythm features (librosa)."""

from pathlib import Path

import librosa
import numpy as np


def compute_bpm(audio_path: Path) -> float:
    """Estimate global tempo in BPM from the mixed-down mono signal."""
    # Default sr=22050 resamples; ample for tempo and faster than full rate.
    y, sr = librosa.load(audio_path, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    # beat_track returns tempo as an array; take the scalar.
    return float(np.atleast_1d(tempo)[0])
