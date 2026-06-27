"""Tonal features (librosa).

Key estimation uses the Krumhansl-Schmuckler method: correlate the song's mean
chroma against the 24 major/minor key profiles and take the best match.
"""

import librosa
import numpy as np

_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles (relative tonal-hierarchy weights).
_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def _best_key(mean_chroma: np.ndarray) -> tuple[str, float]:
    """Return the best (key string, correlation) over all 24 rotated profiles."""
    best_corr = -2.0
    best_name = "C major"
    for tonic in range(12):
        for profile, quality in ((_MAJOR, "major"), (_MINOR, "minor")):
            rotated = np.roll(profile, tonic)
            corr = float(np.corrcoef(mean_chroma, rotated)[0, 1])
            # A silent/constant chroma yields a NaN correlation; skip it so a
            # non-finite value can never become the best match.
            if np.isfinite(corr) and corr > best_corr:
                best_corr = corr
                best_name = f"{_PITCH_CLASSES[tonic]} {quality}"
    return best_name, best_corr


def key(y: np.ndarray, sr: int) -> tuple[dict, dict]:
    """Global key and its confidence (the best profile correlation, clamped 0-1)."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    mean_chroma = chroma.mean(axis=1)
    name, corr = _best_key(mean_chroma)
    confidence = max(0.0, min(1.0, corr))
    key_env = {
        "render": "scalar",
        "category": "tonal",
        "source": "librosa",
        "unit": "key",
        "value": name,
    }
    conf_env = {
        "render": "scalar",
        "category": "tonal",
        "source": "librosa",
        "unit": "normalized",
        "value": confidence,
    }
    return key_env, conf_env


def tuning_deviation(y: np.ndarray, sr: int) -> dict:
    """Deviation from A=440 in cents (one semitone = 100 cents)."""
    tuning = float(librosa.estimate_tuning(y=y, sr=sr))
    return {
        "render": "scalar",
        "category": "tonal",
        "source": "librosa",
        "unit": "cents",
        "value": tuning * 100.0,
    }


def chroma(y: np.ndarray, sr: int, hop: int) -> np.ndarray:
    """Pitch-class energy heatmap: matrix of shape (12, frames).

    Returned as a raw matrix (not an envelope) — written to a .npy sidecar by the
    worker, like other heatmaps.
    """
    return librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
