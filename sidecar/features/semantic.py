"""Semantic audio tagging (PANNs).

`sound_tags` runs the PANNs Cnn14 framewise sound-event-detection model over the
mix and reports per-frame probabilities for a curated set of music-relevant
AudioSet classes, plus any other class that scores highly somewhere in the song.

Two portability fixes around the `panns-inference` package, which otherwise
shells out to `wget` (absent on stock macOS):
  - the AudioSet label CSV is vendored (`sidecar/data/`) and placed where the
    package expects it before import, so its import-time download never fires;
  - the checkpoint is fetched via the project model registry (`models.py`).
"""

import csv
import logging
import shutil
from pathlib import Path

import librosa
import numpy as np

from .. import models

log = logging.getLogger("sidecar.features.semantic")

# PANNs operates at 32 kHz; the curated classes are always reported, and any
# non-curated class peaking above the fallback threshold is added too.
PANNS_SR = 32000
TOPK_THRESHOLD = 0.30

# Vendored AudioSet labels and the path panns-inference reads them from.
_LABELS_CSV = Path(__file__).resolve().parent.parent / "data" / "audioset_labels.csv"
_PANNS_LABELS_PATH = Path.home() / "panns_data" / "class_labels_indices.csv"

# Curated music-relevant AudioSet classes (exact display names), always tracked.
_CURATED = [
    "Guitar",
    "Electric guitar",
    "Acoustic guitar",
    "Bass guitar",
    "Piano",
    "Electric piano",
    "Organ",
    "Synthesizer",
    "Violin, fiddle",
    "Cello",
    "Trumpet",
    "Saxophone",
    "Flute",
    "Drum kit",
    "Drum machine",
    "Snare drum",
    "Bass drum",
    "Hi-hat",
    "Cymbal",
    "Singing",
    "Male singing",
    "Female singing",
    "Choir",
    "Rapping",
    "Electronic music",
    "Rock music",
    "Pop music",
    "Hip hop music",
    "Classical music",
    "Jazz",
    "Ambient music",
    "Distortion",
    "Reverberation",
]


def _load_labels() -> list[str]:
    """AudioSet display names in index order, from the vendored CSV."""
    with _LABELS_CSV.open(newline="") as f:
        return [row["display_name"] for row in csv.DictReader(f)]


def _ensure_panns_labels() -> None:
    """Place the vendored label CSV where panns-inference expects it, so its
    import-time wget download never runs."""
    if not _PANNS_LABELS_PATH.exists():
        _PANNS_LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(_LABELS_CSV, _PANNS_LABELS_PATH)


def sound_tags(y: np.ndarray, sr: int, frame_count: int) -> tuple[dict, np.ndarray]:
    """Per-frame class probabilities as a `tags` feature.

    Returns (envelope, matrix). The matrix is [n_rows, frame_count] float32 in
    0-1, one row per reported class (curated set + high-scoring extras), aligned
    to the shared timeline. The envelope lists the row labels and references the
    matrix's .npy sidecar (written by the worker, like a heatmap).
    """
    _ensure_panns_labels()
    # Imported lazily: importing the package triggers its label-file check, which
    # must see the vendored CSV first; the model is also freed when this returns.
    from panns_inference import SoundEventDetection

    labels = _load_labels()
    name_to_ix = {name: i for i, name in enumerate(labels)}
    checkpoint = models.ensure("panns_cnn14_sed")

    y32 = librosa.resample(y, orig_sr=sr, target_sr=PANNS_SR) if sr != PANNS_SR else y
    sed = SoundEventDetection(checkpoint_path=str(checkpoint), device="cpu")
    framewise = sed.inference(y32[None, :])[0]  # [frames, 527], 0-1

    # Rows to report: every curated class, plus any other class peaking high.
    curated_ix = [name_to_ix[n] for n in _CURATED if n in name_to_ix]
    peaks = framewise.max(axis=0)
    extra_ix = [
        i
        for i in np.argsort(peaks)[::-1]
        if peaks[i] >= TOPK_THRESHOLD and i not in set(curated_ix)
    ]
    row_ix = curated_ix + extra_ix
    row_labels = [labels[i] for i in row_ix]

    # Resample each class track from PANNs' frame rate onto the shared timeline.
    src_t = np.linspace(0.0, 1.0, framewise.shape[0])
    dst_t = np.linspace(0.0, 1.0, frame_count)
    matrix = np.empty((len(row_ix), frame_count), dtype=np.float32)
    for r, i in enumerate(row_ix):
        matrix[r] = np.interp(dst_t, src_t, framewise[:, i])

    envelope = {
        "render": "tags",
        "category": "semantic",
        "source": "panns",
        "status": "wip",
        "unit": "probability",
        "sidecar": "heatmaps/sound_tags.npy",
        "labels": row_labels,
        "shape": [len(row_ix), frame_count],
    }
    log.info(
        "sound_tags: %d rows (%d curated + %d extra)",
        len(row_ix),
        len(curated_ix),
        len(extra_ix),
    )
    return envelope, matrix
