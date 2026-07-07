"""Frequency-domain extractors on a synthetic magnitude spectrogram."""

import librosa
import numpy as np
import pytest

from sidecar.features import frequency

N_FFT = 2048


@pytest.fixture
def spec(sine, hop):
    """Magnitude spectrogram shared across the frequency features."""
    return np.abs(librosa.stft(sine, n_fft=N_FFT, hop_length=hop))


def test_flatness_clamped_to_unit_range(spec):
    out = frequency.spectral_flatness(spec)
    assert out["range"] == [0, 1]
    assert all(0.0 <= v <= 1.0 for v in out["data"])


def test_flux_has_leading_zero_and_matches_frame_count(spec):
    out = frequency.spectral_flux(spec)
    assert out["data"][0] == 0.0
    assert len(out["data"]) == spec.shape[1]  # padded to S's frame count


def test_band_energies_cover_six_bands(spec, sr):
    bands = frequency.band_energies(spec, sr, N_FFT)
    assert set(bands) == {name for name, _, _ in frequency._BANDS}
    for env in bands.values():
        assert all(0.0 <= v <= 1.0 + 1e-6 for v in env["data"])


def test_band_energies_concentrate_a_pure_tone(sr, hop):
    # A 440 Hz tone should put most band energy in the 250-500 Hz bass/low_mid
    # region, not the sub or air bands.
    t = np.arange(sr) / sr
    tone = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    S = np.abs(librosa.stft(tone, n_fft=N_FFT, hop_length=hop))
    bands = frequency.band_energies(S, sr, N_FFT)
    mid_frac = np.mean(bands["band_energy_low_mid"]["data"])
    air_frac = np.mean(bands["band_energy_air"]["data"])
    assert mid_frac > air_frac


def test_continuous_omits_range_when_absent():
    env = frequency._continuous("librosa", "hz", np.array([1.0, 2.0]))
    assert "range" not in env
    assert env["data"] == [1.0, 2.0]
