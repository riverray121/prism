"""Frequency-domain features (librosa).

All operate on a magnitude spectrogram ``S`` the worker computes once and shares,
avoiding a per-feature STFT. ``S`` has shape (1 + n_fft/2, frames).
"""

import librosa
import numpy as np

# Band edges in Hz; the top edge (Nyquist) is appended at runtime from sr.
# sub <60, bass 60-250, low_mid 250-500, mid 500-2k, high_mid 2k-4k, air >4k.
_BANDS = [
    ("band_energy_sub", 0, 60),
    ("band_energy_bass", 60, 250),
    ("band_energy_low_mid", 250, 500),
    ("band_energy_mid", 500, 2000),
    ("band_energy_high_mid", 2000, 4000),
    ("band_energy_air", 4000, None),
]


def _continuous(
    source: str, unit: str, data: np.ndarray, rng: list | None = None
) -> dict:
    env = {
        "render": "continuous",
        "category": "frequency",
        "source": source,
        "unit": unit,
        "data": [float(x) for x in data],
    }
    if rng is not None:
        env["range"] = rng
    return env


def spectral_centroid(S: np.ndarray, sr: int) -> dict:
    """Brightness center: energy-weighted mean frequency, in Hz."""
    c = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    return _continuous("librosa", "hz", c)


def spectral_rolloff(S: np.ndarray, sr: int) -> dict:
    """Frequency below which 85% of spectral energy lies, in Hz."""
    r = librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.85)[0]
    return _continuous("librosa", "hz", r)


def spectral_flatness(S: np.ndarray) -> dict:
    """Tonal (0) vs. noisy (1): geometric-to-arithmetic mean ratio of the spectrum."""
    f = librosa.feature.spectral_flatness(S=S)[0]
    # Silent frames can return slightly above 1.0; clamp to the declared range.
    f = np.clip(f, 0.0, 1.0)
    return _continuous("librosa", "normalized", f, [0, 1])


def spectral_flux(S: np.ndarray) -> dict:
    """Rate of spectral change: summed positive frame-to-frame magnitude increase,
    peak-normalized to 0-1. Padded to the frame count with a leading 0."""
    diff = np.diff(S, axis=1)
    flux = np.clip(diff, 0, None).sum(axis=0)
    flux = np.concatenate([[0.0], flux])  # align to S's frame count
    top = float(flux.max()) if flux.size else 0.0
    normalized = (flux / top) if top > 0 else flux
    return _continuous("librosa", "normalized", normalized, [0, 1])


def spectrogram(y: np.ndarray, sr: int, hop: int, n_fft: int = 1024) -> np.ndarray:
    """Log-power spectrogram in dB for display: matrix of shape (1 + n_fft/2, frames).

    Uses a smaller window than the feature spectrum to keep the sidecar a sane size
    (513 bins at n_fft=1024). Returned as a raw matrix; written to a .npy sidecar
    by the worker. dB is referenced to the per-song max, so values are <= 0.
    """
    mag = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    return librosa.amplitude_to_db(mag, ref=np.max)


def band_energies(S: np.ndarray, sr: int, n_fft: int) -> dict[str, dict]:
    """Per-frame fraction of spectral energy in each of six frequency bands (0-1)."""
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    power = np.square(S)
    total = power.sum(axis=0)
    total = np.where(total > 0, total, 1.0)  # avoid divide-by-zero on silent frames
    out: dict[str, dict] = {}
    for name, lo, hi in _BANDS:
        hi_hz = hi if hi is not None else sr / 2 + 1
        mask = (freqs >= lo) & (freqs < hi_hz)
        frac = power[mask].sum(axis=0) / total
        out[name] = _continuous("librosa", "normalized", frac, [0, 1])
    return out


# Display metadata for this module's heatmap feature; the profile writer builds
# the envelope from it so no other layer hard-codes it.
SPECTROGRAM_HEATMAP = {
    "category": "frequency",
    "unit": "dB",
    "axes": ["freq_hz", "time_frame"],
}
