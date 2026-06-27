"""Single background worker that analyzes queued songs sequentially.

The queue is the set of songs rows with status='queued', oldest first. The
worker claims one and runs it through ordered stages off a single loaded signal:

  dsp-mix   -> every mix-level feature (+ heatmap .npy sidecars)
  separate  -> a configured set of separation engines (audio-separator)
  dsp-stem  -> the per-stem feature pass on every engine's stems

Stage + discrete step (engine k of total) are written to the song row
(current_stage / current_engine / current_step / total_steps) so the UI stays a
pure function of snapshots. No cross-song parallelism.
"""

import gc
import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone

import librosa
import numpy as np

from . import library, models, separation, storage
from .features import (
    amplitude,
    chords,
    frequency,
    rhythm,
    semantic,
    spatial,
    stem,
    structure,
    timbre,
    tonal,
)

log = logging.getLogger("sidecar.worker")

# Seconds to wait between queue polls when idle.
POLL_INTERVAL = 1.0

# Models every analysis needs (chords + PANNs tags/axes). Ensured up front so a
# missing/unreachable checkpoint fails the song before the expensive mix pass
# rather than partway through. Separation engines fetch their own weights.
_REQUIRED_MODELS = ["btc_large_voca", "panns_cnn14_sed"]

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
    # bpm (scalar) + beats, downbeats (event); the structure pass (sections,
    # novelty, motifs — one shared SSM) reuses the beat grid.
    rhythm_feats = rhythm.rhythm_features(y, sr)
    beat_times = [ev["t"] for ev in rhythm_feats["beats"]["events"]]
    mix: dict[str, dict] = {
        **rhythm_feats,
        **structure.structure_features(
            y, sr, beat_times, len(y) // hop + 1, frame_rate_hz
        ),
        "rms": amplitude.rms(y, sr, hop),
        "silence": amplitude.silence(y, sr, hop),
        "rhythmic_density": rhythm.rhythmic_density(y, sr, hop),
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
        "chords": chords.compute_chords(y, sr),
    }
    # Heatmap matrices (raw, shape [bins, frames]); aligned and registered below.
    heatmaps: dict[str, np.ndarray] = {
        "spectrogram": frequency.spectrogram(y, sr, hop),
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
        mix[name] = _heatmap_envelope(name, matrix, f"heatmaps/{name}.npy")

    # PANNs (one inference): sound_tags + the timbral axes. sound_tags builds its
    # own envelope (dynamic class labels) and arrives frame_count-aligned, so it
    # bypasses the heatmap-envelope loop above; its matrix still rides the
    # heatmaps dict to be written to disk. The axes are continuous, already
    # frame_count-length, added straight to the mix.
    tags_env, tags_matrix, axes = semantic.panns_features(y, sr, frame_count)
    mix["sound_tags"] = tags_env
    mix.update(axes)
    heatmaps["sound_tags"] = tags_matrix

    return frame_rate_hz, frame_count, mix, heatmaps


# Per-heatmap display metadata; the payload itself lives in the .npy sidecar.
_HEATMAP_META = {
    "spectrogram": {
        "category": "frequency",
        "unit": "dB",
        "axes": ["freq_hz", "time_frame"],
    },
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


def _heatmap_envelope(name: str, matrix: np.ndarray, sidecar: str) -> dict:
    """Build a heatmap feature envelope referencing its .npy sidecar by path."""
    meta = _HEATMAP_META[name]
    return {
        "render": "heatmap",
        "category": meta["category"],
        "source": "librosa",
        "unit": meta["unit"],
        "sidecar": sidecar,
        "shape": [int(matrix.shape[0]), int(matrix.shape[1])],
        "axes": meta["axes"],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _claim_next() -> dict | None:
    """Claim the oldest queued song, flipping it to 'analyzing'. Sole consumer.

    The flip is guarded to ``status='queued'``; if a concurrent ``cancel_queued``
    moved the row out of the queue between the SELECT and the UPDATE, the claim is
    lost and we return None to re-poll rather than resurrecting a cancelled song.
    """
    with library.connect() as con:
        row = library.next_queued(con)
        if row is None:
            return None
        if not library.mark_analyzing(con, row["id"]):
            return None  # lost the claim (cancelled between select and update)
    return dict(row)


def _set_stage(
    song_id: str,
    stage: str,
    on_change: Callable[[], None],
    *,
    engine: str | None = None,
    step: int | None = None,
    total: int | None = None,
) -> None:
    """Record the worker's current stage (+ engine step k/total) and push a snapshot."""
    with library.connect() as con:
        library.mark_stage(con, song_id, stage, engine=engine, step=step, total=total)
    on_change()


def _stem_entry(
    song_id: str,
    stem_path,
    sr: int,
    hop: int,
    frame_count: int,
    stem_name: str,
    heatmap_prefix: str,
    audio_file: str,
) -> dict:
    """Run the per-stem DSP pass on one stem WAV; return its profile entry.

    Writes the stem's mfcc heatmap under ``heatmaps/{heatmap_prefix}/{stem}_*.npy``
    and registers its envelope. Used for both top-level stems and drum sub-stems.
    """
    ys, _ = librosa.load(stem_path, sr=sr, mono=True)
    features, heatmaps = stem.stem_features(ys, sr, hop, frame_count, stem_name)
    for hname, matrix in heatmaps.items():
        rel = f"{heatmap_prefix}/{stem_name}_{hname}"
        storage.write_heatmap(song_id, rel, matrix)
        features[hname] = _heatmap_envelope(hname, matrix, f"heatmaps/{rel}.npy")
    return {"audio_file": audio_file, "features": features}


def _separate_and_analyze_stems(
    song_id: str,
    audio_path,
    sr: int,
    hop: int,
    frame_count: int,
    on_change: Callable[[], None],
) -> dict[str, dict]:
    """Run each configured engine's separation + per-stem DSP; return the stems map.

    For each engine: separate into stem WAVs (separate stage), then run the per-stem
    feature pass on every stem (dsp-stem stage). When drum sub-separation is enabled,
    a `drums` stem is further split into kick/snare/etc., each analyzed and attached
    under the drums entry's ``substems``. Returns
    ``{engine: {stem: {audio_file, features[, substems]}}}`` for the profile.
    """
    stems_root = storage.SONGS_DIR / song_id / "stems"
    # Engine set + drum sub-separation are user settings (Analysis settings panel).
    with library.connect() as con:
        engines = library.get_engines(con)
        drum_subsep = library.get_drum_subsep(con)
    total = len(engines)
    result: dict[str, dict] = {}

    for i, engine in enumerate(engines):
        _set_stage(
            song_id, "separate", on_change, engine=engine, step=i + 1, total=total
        )
        stem_paths = separation.separate(audio_path, stems_root / engine, engine)

        # One dsp-stem transition per engine; the per-stem loop carries no new
        # stage info, so don't re-emit it for every stem.
        _set_stage(
            song_id, "dsp-stem", on_change, engine=engine, step=i + 1, total=total
        )
        engine_stems: dict[str, dict] = {}
        for stem_name, path in stem_paths.items():
            entry = _stem_entry(
                song_id,
                path,
                sr,
                hop,
                frame_count,
                stem_name,
                engine,
                f"stems/{engine}/{stem_name}.wav",
            )
            # Second stage: split the drums stem into kick/snare/etc. Shown as a
            # distinct transient, then dsp-stem is restored for the remaining stems.
            if drum_subsep and stem_name == "drums":
                _set_stage(
                    song_id,
                    "drum-subsep",
                    on_change,
                    engine=engine,
                    step=i + 1,
                    total=total,
                )
                sub_dir = stems_root / engine / "drums"
                sub_paths = separation.separate_drums(path, sub_dir)
                entry["substems"] = {
                    sub: _stem_entry(
                        song_id,
                        sub_path,
                        sr,
                        hop,
                        frame_count,
                        sub,
                        f"{engine}/drums",
                        f"stems/{engine}/drums/{sub}.wav",
                    )
                    for sub, sub_path in sub_paths.items()
                }
            engine_stems[stem_name] = entry
        result[engine] = engine_stems

    return result


def _process(song: dict, on_change: Callable[[], None]) -> None:
    song_id = song["id"]
    on_change()  # reflect 'analyzing'
    try:
        # Fail fast if a required model is missing/unreachable, before any work.
        for model_name in _REQUIRED_MODELS:
            models.ensure(model_name)

        audio_path = storage.LIBRARY_ROOT / song["source_path"]
        # Load once, keeping channels for spatial features; derive mono for the rest.
        y_stereo, sr = librosa.load(audio_path, mono=False)
        y = librosa.to_mono(y_stereo)
        hop = max(1, round(sr / TARGET_FRAME_RATE_HZ))

        # Stage: mix-level DSP. Heatmap payloads go to .npy sidecars; only their
        # envelopes sit in the profile.
        _set_stage(song_id, "dsp-mix", on_change)
        frame_rate_hz, frame_count, mix, heatmaps = _analyze(y, y_stereo, sr)
        for name, matrix in heatmaps.items():
            storage.write_heatmap(song_id, name, matrix)

        # Release the large mix-stage arrays (~150–200 MB) before separation — the
        # most memory-hungry phase; the stem stage reloads stems from disk.
        del y, y_stereo, heatmaps
        gc.collect()

        # Stages: separation + per-stem DSP across the configured engine set.
        stems = _separate_and_analyze_stems(
            song_id, audio_path, sr, hop, frame_count, on_change
        )

        analyzed_at = _now()
        storage.write_profile(
            song,
            analyzed_at=analyzed_at,
            frame_rate_hz=frame_rate_hz,
            frame_count=frame_count,
            mix=mix,
            stems=stems,
        )
        with library.connect() as con:
            library.mark_analyzed(con, song_id, analyzed_at)
        log.info(
            "analyzed %s bpm=%.1f features=%d frames=%d engines=%d",
            song_id,
            mix["bpm"]["value"],
            len(mix),
            frame_count,
            len(stems),
        )
    except Exception as exc:
        log.exception("analysis failed: %s", song_id)
        # Drop partial separation output so a retry starts clean.
        storage.cleanup_partial(song_id)
        with library.connect() as con:
            library.mark_failed(con, song_id, str(exc))
    # Terminal snapshot (reflect 'analyzed'/'failed'). Guarded so a failure to emit
    # — after the DB row is already final — doesn't propagate into the run() loop.
    try:
        on_change()
    except Exception:
        log.exception("terminal snapshot emit failed: %s", song_id)


def run(on_change: Callable[[], None]) -> None:
    """Loop forever, analyzing queued songs. on_change fires after each status change.

    The loop body is the supervision boundary: a transient DB/IO error while claiming
    (lock beyond timeout, disk error) must not kill this daemon thread and halt all
    analysis for the process lifetime. Log it, back off briefly, and keep polling.
    """
    log.info("worker started")
    while True:
        try:
            song = _claim_next()
            if song is None:
                time.sleep(POLL_INTERVAL)
                continue
            _process(song, on_change)
        except Exception:
            log.exception("worker loop error; continuing")
            time.sleep(POLL_INTERVAL)
