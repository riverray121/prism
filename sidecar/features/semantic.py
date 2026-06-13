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


# Timbral axes: each a 0-1 per-frame contrast between two groups of AudioSet
# classes (value -> 1 favors the right pole, 0.5 = balanced / nothing detected).
# Derived from the same framewise output as sound_tags — no second inference.
# [WIP] — curated heuristic class groups.
_ELECTRONIC = ["Synthesizer", "Electronic music", "Drum machine"]
_ORGANIC = [
    "Acoustic guitar", "Piano", "Violin, fiddle", "Cello",
    "Trumpet", "Saxophone", "Flute", "Singing",
]  # fmt: skip
_PERCUSSIVE = ["Drum kit", "Snare drum", "Bass drum", "Hi-hat", "Cymbal"]
_TONAL = [
    "Piano", "Guitar", "Bass guitar", "Violin, fiddle", "Cello",
    "Trumpet", "Saxophone", "Flute", "Organ", "Singing",
]  # fmt: skip
_INSTRUMENTAL = [
    "Guitar", "Piano", "Synthesizer", "Drum kit", "Bass guitar",
    "Violin, fiddle", "Trumpet", "Saxophone", "Flute", "Organ",
]  # fmt: skip
_VOCAL = ["Singing", "Male singing", "Female singing", "Choir", "Rapping"]
# (feature key, low-pole classes [value 0], high-pole classes [value 1]).
_AXES = [
    ("electronic_organic", _ELECTRONIC, _ORGANIC),
    ("percussive_tonal", _PERCUSSIVE, _TONAL),
    ("instrumental_vocal", _INSTRUMENTAL, _VOCAL),
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


def _axis_track(
    framewise: np.ndarray, name_to_ix: dict[str, int], left: list[str], right: list[str]
) -> np.ndarray:
    """Per-frame contrast in [0,1]: right-pole dominance over both poles' mean
    probability, 0.5 where neither pole is detected."""
    li = [name_to_ix[n] for n in left if n in name_to_ix]
    ri = [name_to_ix[n] for n in right if n in name_to_ix]
    lo = framewise[:, li].mean(axis=1)
    hi = framewise[:, ri].mean(axis=1)
    total = lo + hi
    return np.where(total > 1e-3, hi / np.maximum(total, 1e-9), 0.5)


def panns_features(
    y: np.ndarray, sr: int, frame_count: int
) -> tuple[dict, np.ndarray, dict[str, dict]]:
    """Run PANNs once; derive sound_tags and the timbral axes from one inference.

    Returns (tags_envelope, tags_matrix, axes). The matrix is [n_rows,
    frame_count] float32 in 0-1, one row per reported class (curated + high
    extras); the envelope references its .npy sidecar (written by the worker).
    ``axes`` maps each axis key to a continuous feature (0-1, aligned to the
    shared timeline).
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

    # Resample any PANNs-rate track onto the shared timeline.
    src_t = np.linspace(0.0, 1.0, framewise.shape[0])
    dst_t = np.linspace(0.0, 1.0, frame_count)

    # sound_tags: every curated class, plus any other class peaking high.
    curated_ix = [name_to_ix[n] for n in _CURATED if n in name_to_ix]
    peaks = framewise.max(axis=0)
    extra_ix = [
        i
        for i in np.argsort(peaks)[::-1]
        if peaks[i] >= TOPK_THRESHOLD and i not in set(curated_ix)
    ]
    row_ix = curated_ix + extra_ix
    matrix = np.empty((len(row_ix), frame_count), dtype=np.float32)
    for r, i in enumerate(row_ix):
        matrix[r] = np.interp(dst_t, src_t, framewise[:, i])

    tags_env = {
        "render": "tags",
        "category": "semantic",
        "source": "panns",
        "status": "wip",
        "unit": "probability",
        "sidecar": "heatmaps/sound_tags.npy",
        "labels": [labels[i] for i in row_ix],
        "shape": [len(row_ix), frame_count],
    }

    # timbral_axes: curated perceptual contrasts, each a continuous feature.
    axes = {
        key: {
            "render": "continuous",
            "category": "timbre",
            "source": "panns",
            "status": "wip",
            "unit": "normalized",
            "range": [0, 1],
            "data": [
                float(x)
                for x in np.interp(
                    dst_t, src_t, _axis_track(framewise, name_to_ix, left, right)
                )
            ],
        }
        for key, left, right in _AXES
    }

    log.info(
        "panns: sound_tags %d rows (%d curated + %d extra), %d axes",
        len(row_ix),
        len(curated_ix),
        len(extra_ix),
        len(axes),
    )
    return tags_env, matrix, axes
