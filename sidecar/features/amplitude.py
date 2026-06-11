"""Amplitude features (librosa / numpy).

Continuous features are sampled on the shared timeline hop the worker passes in,
so every continuous feature in a profile lines up frame-for-frame.
"""

import librosa
import numpy as np
import pyloudnorm as pyln


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


def loudness_lufs(y: np.ndarray, sr: int, hop: int) -> dict:
    """Perceptual loudness over time (LUFS), per ITU-R BS.1770 K-weighting.

    K-weights the signal once, then takes the mean square over a 400 ms momentary
    window centered on each timeline frame. Values are negative (e.g. -30 to -6).
    """
    meter = pyln.Meter(sr)
    weighted = y.astype(np.float64)
    # Apply the meter's K-weighting filters (high-shelf + high-pass).
    for f in meter._filters.values():
        weighted = f.apply_filter(weighted)
    msq = weighted**2

    half = max(1, int(0.4 * sr) // 2)  # half of the 400 ms momentary window
    cumsum = np.cumsum(np.insert(msq, 0, 0.0))
    n_frames = 1 + len(msq) // hop
    centers = np.arange(n_frames) * hop
    lo = np.clip(centers - half, 0, len(msq))
    hi = np.clip(centers + half, 0, len(msq))
    mean_sq = (cumsum[hi] - cumsum[lo]) / np.maximum(1, hi - lo)
    lufs = -0.691 + 10.0 * np.log10(mean_sq + 1e-12)
    # Floor at the EBU R128 absolute gate; silent frames otherwise dominate the scale.
    lufs = np.maximum(lufs, -70.0)
    return {
        "render": "continuous",
        "category": "amplitude",
        "source": "pyloudnorm",
        "unit": "LUFS",
        "data": [float(x) for x in lufs],
    }


# Silence detection: a frame is silent below this many dB under the signal peak,
# and only runs of at least MIN_SILENCE_SEC count as a segment (sub-perceptual
# gaps between notes would otherwise litter the lane).
SILENCE_TOP_DB = 60.0
MIN_SILENCE_SEC = 0.2


def silence(y: np.ndarray, sr: int, hop: int) -> dict:
    """Silent regions as segments: spans quieter than SILENCE_TOP_DB below peak."""
    intervals = librosa.effects.split(y, top_db=SILENCE_TOP_DB, hop_length=hop)
    total = len(y) / sr
    # Complement of the non-silent intervals, in seconds.
    segments = []
    prev_end = 0.0
    for start, end in intervals:
        gap_end = float(start) / sr
        if gap_end - prev_end >= MIN_SILENCE_SEC:
            segments.append({"start": prev_end, "end": gap_end, "label": "silence"})
        prev_end = float(end) / sr
    if total - prev_end >= MIN_SILENCE_SEC:
        segments.append({"start": prev_end, "end": total, "label": "silence"})
    return {
        "render": "segment",
        "category": "amplitude",
        "source": "librosa",
        "segments": segments,
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
