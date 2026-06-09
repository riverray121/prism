"""Pitch and vibrato features (librosa pYIN + derived).

``pitch`` runs pYIN once to get an f0 contour and voicing confidence, returning
both as continuous envelopes plus the raw f0 in cents for ``vibrato`` to reuse.
``vibrato`` is a v1 proxy: it detrends the pitch contour to isolate the vibrato
oscillation, then estimates its rate (Hz) and depth (cents) over a sliding window.
"""

import librosa
import numpy as np
from scipy.ndimage import uniform_filter1d

# pYIN search range: C2 (~65 Hz) to C7 (~2093 Hz) covers bass through vocals.
_FMIN = librosa.note_to_hz("C2")
_FMAX = librosa.note_to_hz("C7")


def pitch(y: np.ndarray, sr: int, hop: int) -> tuple[np.ndarray, dict, dict]:
    """f0 contour + voicing confidence via pYIN.

    Returns ``(f0_cents, pitch_feature, confidence_feature)``. ``f0_cents`` is the
    raw pitch in cents above ``_FMIN`` (NaN where unvoiced) for ``vibrato`` to
    reuse. The features are continuous envelopes: pitch in Hz (0 where unvoiced),
    confidence the per-frame voicing probability.
    """
    f0, _, voiced_prob = librosa.pyin(y, fmin=_FMIN, fmax=_FMAX, sr=sr, hop_length=hop)
    pitch_hz = np.nan_to_num(f0, nan=0.0)
    # Cents above _FMIN; NaN propagates through unvoiced frames.
    f0_cents = 1200.0 * np.log2(np.where(f0 > 0, f0, np.nan) / _FMIN)
    pitch_feature = {
        "render": "continuous",
        "category": "tonal",
        "source": "librosa.pyin",
        "unit": "hz",
        "data": [float(x) for x in pitch_hz],
    }
    confidence_feature = {
        "render": "continuous",
        "category": "tonal",
        "source": "librosa.pyin",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in np.nan_to_num(voiced_prob, nan=0.0)],
    }
    return f0_cents, pitch_feature, confidence_feature


def vibrato(f0_cents: np.ndarray, frame_rate: float) -> tuple[dict, dict]:
    """Vibrato rate (Hz) and depth (cents) over time, a v1 proxy from the pitch.

    Detrends the pitch contour with a ~0.25 s moving average to isolate the
    vibrato oscillation, then over a ~0.5 s sliding window estimates depth (RMS of
    the detrended pitch, in cents) and rate (zero-crossing rate / 2, in Hz). Both
    are zeroed on unvoiced frames.
    """
    voiced = ~np.isnan(f0_cents)
    cents = np.nan_to_num(f0_cents, nan=0.0)

    detrend_win = max(1, int(0.25 * frame_rate))
    detrended = cents - uniform_filter1d(cents, detrend_win, mode="nearest")

    window = max(1, int(0.5 * frame_rate))
    # Depth: windowed RMS of the detrended pitch (cents).
    depth = np.sqrt(
        np.maximum(uniform_filter1d(detrended**2, window, mode="nearest"), 0.0)
    )
    # Rate: windowed zero-crossing rate of the detrended pitch → Hz (2 crossings
    # per oscillation).
    crossings = np.zeros_like(detrended)
    crossings[1:] = np.abs(np.diff(np.sign(detrended))) > 0
    rate = uniform_filter1d(crossings, window, mode="nearest") * frame_rate / 2.0

    depth = np.where(voiced, depth, 0.0)
    rate = np.where(voiced, rate, 0.0)

    rate_feature = {
        "render": "continuous",
        "category": "tonal",
        "source": "derived",
        "unit": "hz",
        "data": [float(x) for x in rate],
    }
    depth_feature = {
        "render": "continuous",
        "category": "tonal",
        "source": "derived",
        "unit": "cents",
        "data": [float(x) for x in depth],
    }
    return rate_feature, depth_feature
