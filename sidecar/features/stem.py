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

from . import amplitude, frequency, pitch, rhythm, timbre

# STFT window for the per-stem magnitude spectrogram; matches the worker's mix N_FFT.
_N_FFT = 2048

# Percussion stems get no pitch contour: the drums stem and its drum sub-stems.
_PERCUSSION = {"drums", "kick", "snare", "toms", "hh", "ride", "crash"}


def stem_features(
    y: np.ndarray, sr: int, hop: int, frame_count: int, stem_name: str
) -> tuple[dict[str, dict], dict[str, np.ndarray]]:
    """Compute per-stem features off one mono stem signal.

    Feature set depends on the stem: every stem gets energy, spectral centroid,
    onsets, transient sharpness, and an MFCC heatmap; non-percussion stems also get
    a pitch contour (pYIN); vocals additionally get vibrato. Returns
    (features, heatmaps): ``features`` are envelopes keyed by name; ``heatmaps`` are
    raw matrices for the worker to write as sidecars. Both aligned to ``frame_count``.
    """
    # Magnitude spectrogram shared by the spectral features, as in the mix pass.
    spectrum = np.abs(librosa.stft(y, n_fft=_N_FFT, hop_length=hop))

    features: dict[str, dict] = {
        "energy": amplitude.rms(y, sr, hop),
        "spectral_centroid": frequency.spectral_centroid(spectrum, sr),
        "onsets": rhythm.onsets(y, sr, hop),
        "transient_sharpness": timbre.transient_sharpness(y, sr, hop),
    }
    # Pitch for melodic (non-percussion) stems; vibrato for vocals only.
    if stem_name not in _PERCUSSION:
        f0_cents, pitch_feat, confidence_feat = pitch.pitch(y, sr, hop)
        features["pitch"] = pitch_feat
        features["pitch_confidence"] = confidence_feat
        if stem_name == "vocals":
            rate_feat, depth_feat = pitch.vibrato(f0_cents, sr / hop)
            features["vibrato_rate"] = rate_feat
            features["vibrato_depth"] = depth_feat

    heatmaps: dict[str, np.ndarray] = {
        "mfcc": timbre.mfcc(y, sr, hop),
    }

    # Align to the shared timeline: truncate continuous data and heatmap columns;
    # event features (onsets) carry absolute times and need no truncation.
    for f in features.values():
        if f["render"] == "continuous":
            f["data"] = f["data"][:frame_count]
    for name, matrix in heatmaps.items():
        heatmaps[name] = matrix[:, :frame_count]

    return features, heatmaps
