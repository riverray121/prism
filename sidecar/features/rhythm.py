"""Rhythm features (librosa)."""

import librosa
import numpy as np

# Assumed time signature for downbeat inference. The heuristic picks one of
# METER beat phases as the bar start; non-4/4 meters will be wrong (see
# docs/dev-log.md for upgrade paths).
METER = 4


def _infer_downbeats(y: np.ndarray, sr: int, beat_frames: np.ndarray) -> np.ndarray:
    """Pick the bar-start beat phase and return downbeat times.

    Assumes 4/4. Scores each of the METER beat phases by two cues sampled at the
    beats — onset strength and low-band (<150 Hz, i.e. kick) energy — and takes
    every METER-th beat from the highest-scoring phase. beat_frames, the onset
    envelope, and the STFT all use librosa's default 512-sample hop, so the
    frame indices line up directly.
    """
    if len(beat_frames) < METER:
        return librosa.frames_to_time(beat_frames, sr=sr)

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    spectrum = np.abs(librosa.stft(y))
    freqs = librosa.fft_frequencies(sr=sr)
    low_band = spectrum[freqs < 150].sum(axis=0)

    def _norm(a: np.ndarray) -> np.ndarray:
        return a / (a.max() + 1e-9)

    score = _norm(onset_env) + _norm(low_band)
    beat_scores = score[np.clip(beat_frames, 0, len(score) - 1)]
    phase = max(range(METER), key=lambda p: beat_scores[p::METER].mean())
    return librosa.frames_to_time(beat_frames[phase::METER], sr=sr)


def rhythm_features(y: np.ndarray, sr: int) -> dict[str, dict]:
    """Global tempo, beat positions, and downbeats from one beat-tracking pass.

    Returns bpm (scalar), beats (event), and downbeats (event) together so all
    come from the same analysis (consistent tempo and beat grid). Downbeats are
    inferred from the beat grid by a 4/4 heuristic, not a separate tracker.
    """
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    downbeat_times = _infer_downbeats(y, sr, beat_frames)
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
        "downbeats": {
            "render": "event",
            "category": "rhythm",
            "source": "librosa (heuristic)",
            "events": [
                {"t": float(t), "bar": i + 1} for i, t in enumerate(downbeat_times)
            ],
        },
    }
