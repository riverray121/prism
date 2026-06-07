"""Single background worker that analyzes queued songs sequentially.

The queue is the set of songs rows with status='queued', oldest first. The
worker claims one, runs every mix-level feature off a single loaded signal, and
writes status + profile.json (+ heatmap .npy sidecars). No cross-song parallelism.
"""

import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone

import librosa
import numpy as np

from . import library, storage
from .features import amplitude, frequency, rhythm, spatial, timbre, tonal

log = logging.getLogger("sidecar.worker")

# Seconds to wait between queue polls when idle.
POLL_INTERVAL = 1.0

# Target frame rate for continuous features; the actual rate is sr/hop. n_fft is
# the STFT window shared across frequency features.
TARGET_FRAME_RATE_HZ = 100
N_FFT = 2048


def _analyze(
    y: np.ndarray, y_stereo: np.ndarray, sr: int
) -> tuple[float, int, dict[str, dict], dict[str, np.ndarray]]:
    """Run every mix-level feature off one loaded signal.

    ``y`` is mono (most features); ``y_stereo`` is the raw load (mono or 2-channel)
    for spatial features. Returns (frame_rate_hz, frame_count, mix, heatmaps).
    Continuous features and heatmap matrices are truncated to a shared frame_count
    so they line up on the timeline; heatmaps are written to .npy by the caller.
    """
    hop = max(1, round(sr / TARGET_FRAME_RATE_HZ))
    frame_rate_hz = sr / hop
    # Magnitude spectrogram, computed once and shared by the frequency features.
    spectrum = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=hop))

    key_env, key_conf = tonal.key(y, sr)
    mix: dict[str, dict] = {
        **rhythm.rhythm_features(y, sr),  # bpm (scalar) + beats (event)
        "rms": amplitude.rms(y, sr, hop),
        "peak": amplitude.peak(y, sr, hop),
        "loudness_lufs": amplitude.loudness_lufs(y, sr, hop),
        "dynamic_range": amplitude.dynamic_range(y, sr),
        "spectral_centroid": frequency.spectral_centroid(spectrum, sr),
        "spectral_rolloff": frequency.spectral_rolloff(spectrum, sr),
        "spectral_flatness": frequency.spectral_flatness(spectrum),
        "spectral_flux": frequency.spectral_flux(spectrum),
        **frequency.band_energies(spectrum, sr, N_FFT),
        "zero_crossing_rate": timbre.zero_crossing_rate(y, hop),
        "stereo_width": spatial.stereo_width(y_stereo, sr, hop),
        "key": key_env,
        "key_confidence": key_conf,
        "tuning_deviation": tonal.tuning_deviation(y, sr),
    }
    # Heatmap matrices (raw, shape [bins, frames]); aligned and registered below.
    heatmaps: dict[str, np.ndarray] = {
        "mfcc": timbre.mfcc(y, sr, hop),
        "chroma": tonal.chroma(y, sr, hop),
    }

    # Align continuous features: truncate each to the shortest so they share one
    # frame_count (librosa feature lengths can differ by a frame from centering).
    lengths = [len(f["data"]) for f in mix.values() if f["render"] == "continuous"]
    frame_count = min(lengths) if lengths else 0
    for f in mix.values():
        if f["render"] == "continuous":
            f["data"] = f["data"][:frame_count]

    # Truncate heatmaps to frame_count and register their envelopes in the mix.
    for name, matrix in heatmaps.items():
        matrix = matrix[:, :frame_count]
        heatmaps[name] = matrix
        mix[name] = _heatmap_envelope(name, matrix)

    return frame_rate_hz, frame_count, mix, heatmaps


# Per-heatmap display metadata; the payload itself lives in the .npy sidecar.
_HEATMAP_META = {
    "mfcc": {
        "category": "timbre",
        "unit": "coefficient",
        "axes": ["mfcc", "time_frame"],
    },
    "chroma": {
        "category": "tonal",
        "unit": "energy",
        "axes": ["pitch_class", "time_frame"],
    },
}


def _heatmap_envelope(name: str, matrix: np.ndarray) -> dict:
    meta = _HEATMAP_META[name]
    return {
        "render": "heatmap",
        "category": meta["category"],
        "source": "librosa",
        "unit": meta["unit"],
        "sidecar": f"heatmaps/{name}.npy",
        "shape": [int(matrix.shape[0]), int(matrix.shape[1])],
        "axes": meta["axes"],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _claim_next() -> dict | None:
    """Claim the oldest queued song, flipping it to 'analyzing'. Sole consumer."""
    with library.connect() as con:
        row = library.next_queued(con)
        if row is None:
            return None
        library.mark_analyzing(con, row["id"])
    return dict(row)


def _process(song: dict, on_change: Callable[[], None]) -> None:
    song_id = song["id"]
    on_change()  # reflect 'analyzing'
    try:
        audio_path = storage.LIBRARY_ROOT / song["source_path"]
        # Load once, keeping channels for spatial features; derive mono for the rest.
        y_stereo, sr = librosa.load(audio_path, mono=False)
        y = librosa.to_mono(y_stereo)
        frame_rate_hz, frame_count, mix, heatmaps = _analyze(y, y_stereo, sr)
        # Heatmap payloads go to .npy sidecars; only their envelopes sit in the profile.
        for name, matrix in heatmaps.items():
            storage.write_heatmap(song_id, name, matrix)
        analyzed_at = _now()
        storage.write_profile(
            song,
            analyzed_at=analyzed_at,
            frame_rate_hz=frame_rate_hz,
            frame_count=frame_count,
            mix=mix,
        )
        with library.connect() as con:
            library.mark_analyzed(con, song_id, analyzed_at)
        log.info(
            "analyzed %s bpm=%.1f features=%d frames=%d",
            song_id,
            mix["bpm"]["value"],
            len(mix),
            frame_count,
        )
    except Exception as exc:
        log.exception("analysis failed: %s", song_id)
        with library.connect() as con:
            library.mark_failed(con, song_id, str(exc))
    on_change()  # reflect 'analyzed' or 'failed'


def run(on_change: Callable[[], None]) -> None:
    """Loop forever, analyzing queued songs. on_change fires after each status change."""
    log.info("worker started")
    while True:
        song = _claim_next()
        if song is None:
            time.sleep(POLL_INTERVAL)
            continue
        _process(song, on_change)
