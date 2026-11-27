"""Rhythm features: librosa onsets and density, Beat This! beats and downbeats."""

import librosa
import numpy as np
from scipy.ndimage import uniform_filter1d

from .. import models

# Window for the rhythmic-density running rate, in seconds.
DENSITY_WINDOW_SEC = 2.0

# Beat This! model, loaded once per process on first use (CPU: about 1.5 s
# per song on an M-series Mac, faster than MPS for this model size).
_BEAT_MODEL = None


def _beat_model():
    global _BEAT_MODEL
    if _BEAT_MODEL is None:
        from beat_this.inference import Audio2Beats

        _BEAT_MODEL = Audio2Beats(
            checkpoint_path=str(models.ensure("beat_this_final0")), device="cpu"
        )
    return _BEAT_MODEL


def _snap_downbeats(beats: np.ndarray, downbeats: np.ndarray) -> np.ndarray:
    """Beat This! predicts beats and downbeats as separate activations, so a
    downbeat can sit a few ms off its beat. Snap each to the nearest beat so
    downbeats stay a subset of the beat grid."""
    if len(beats) == 0:
        return downbeats
    idx = np.abs(beats[None, :] - downbeats[:, None]).argmin(axis=1)
    return np.unique(beats[idx])


def onsets(y: np.ndarray, sr: int, hop: int) -> dict:
    """Onset events with peak-normalized attack strength.

    Detects note/hit onsets from the onset-strength envelope (sampled on the
    timeline hop) and attaches each onset's strength (0-1) as an event attr.
    """
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=False
    )
    times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
    peak = float(onset_env.max()) if onset_env.size else 0.0
    strengths = onset_env[onset_frames] / peak if peak > 0 else onset_env[onset_frames]
    return {
        "render": "event",
        "category": "rhythm",
        "source": "librosa.onset",
        "events": [
            {"t": float(t), "strength": float(s)} for t, s in zip(times, strengths)
        ],
    }


def rhythmic_density(y: np.ndarray, sr: int, hop: int) -> dict:
    """Running onset rate (onsets/sec) over a sliding window.

    Detects onsets on the timeline hop, lays them on the frame grid as a binary
    train, then takes a windowed running mean scaled to onsets per second.
    """
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=False
    )
    frame_rate = sr / hop
    train = np.zeros(len(onset_env))
    train[onset_frames] = 1.0
    win = max(1, round(DENSITY_WINDOW_SEC * frame_rate))
    # mean-over-window * frame_rate = count-over-window / window_seconds.
    density = uniform_filter1d(train, size=win) * frame_rate
    return {
        "render": "continuous",
        "category": "rhythm",
        "source": "librosa.onset",
        "unit": "onsets/sec",
        "data": [float(x) for x in density],
    }


def rhythm_features(y: np.ndarray, sr: int) -> dict[str, dict]:
    """Global tempo, beat positions, and downbeats from one Beat This! pass.

    Returns bpm (scalar), beats (event), and downbeats (event) from the same
    tracker, so the tempo, beat grid and bar starts agree. Beat This! makes no
    meter assumption. bpm is 60 over the median inter-beat interval.
    """
    beats, downbeats = _beat_model()(y, sr)
    beats = np.asarray(beats, dtype=np.float64)
    downbeats = _snap_downbeats(beats, np.asarray(downbeats, dtype=np.float64))
    bpm = float(60.0 / np.median(np.diff(beats))) if len(beats) >= 2 else 0.0
    return {
        "bpm": {
            "render": "scalar",
            "category": "rhythm",
            "source": "beat_this",
            "unit": "bpm",
            "value": bpm,
        },
        "beats": {
            "render": "event",
            "category": "rhythm",
            "source": "beat_this",
            "events": [{"t": float(t)} for t in beats],
        },
        "downbeats": {
            "render": "event",
            "category": "rhythm",
            "source": "beat_this",
            "events": [{"t": float(t), "bar": i + 1} for i, t in enumerate(downbeats)],
        },
    }
