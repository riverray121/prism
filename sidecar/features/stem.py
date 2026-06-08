"""Per-stem DSP feature pass.

Runs a subset of the mix-level extractors on a single separated stem, reusing the
same functions so per-stem features are directly comparable to the mix and across
separation engines. Returns the feature envelopes plus raw heatmap matrices (the
worker writes those to .npy sidecars). Continuous features and heatmaps are
truncated to the song's shared ``frame_count`` so every stem overlays on the
100 Hz timeline.

Slice 1 set: energy (RMS), spectral_centroid, mfcc (heatmap). Onsets, transient
sharpness, pitch, and vibrato arrive in a later slice.
"""

import librosa
import numpy as np

from . import amplitude, frequency, timbre

# STFT window for the per-stem magnitude spectrogram; matches the worker's mix N_FFT.
_N_FFT = 2048


def stem_features(
    y: np.ndarray, sr: int, hop: int, frame_count: int
) -> tuple[dict[str, dict], dict[str, np.ndarray]]:
    """Compute per-stem features off one mono stem signal.

    Returns (features, heatmaps): ``features`` are continuous/scalar envelopes keyed
    by feature name; ``heatmaps`` are raw matrices for the worker to write as
    sidecars. Both are aligned to ``frame_count``.
    """
    # Magnitude spectrogram shared by the spectral features, as in the mix pass.
    spectrum = np.abs(librosa.stft(y, n_fft=_N_FFT, hop_length=hop))

    features: dict[str, dict] = {
        "energy": amplitude.rms(y, sr, hop),
        "spectral_centroid": frequency.spectral_centroid(spectrum, sr),
    }
    heatmaps: dict[str, np.ndarray] = {
        "mfcc": timbre.mfcc(y, sr, hop),
    }

    # Align to the shared timeline: truncate continuous data and heatmap columns.
    for f in features.values():
        if f["render"] == "continuous":
            f["data"] = f["data"][:frame_count]
    for name, matrix in heatmaps.items():
        heatmaps[name] = matrix[:, :frame_count]

    return features, heatmaps
