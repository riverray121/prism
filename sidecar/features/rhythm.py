"""Rhythm features (librosa)."""

import librosa
import numpy as np


def rhythm_features(y: np.ndarray, sr: int) -> dict[str, dict]:
    """Global tempo and beat positions from one beat-tracking pass.

    Returns the bpm scalar and the beats event feature together so both come
    from the same analysis (consistent tempo and beat grid).
    """
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    return {
        "bpm": {
            "render": "scalar",
            "category": "rhythm",
            "source": "librosa.beat",
            "unit": "bpm",
            "value": bpm,
        },
        "beats": {
            "render": "event",
            "category": "rhythm",
            "source": "librosa.beat",
            "events": [{"t": float(t)} for t in beat_times],
        },
    }
