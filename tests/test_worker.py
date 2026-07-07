"""Pure worker helpers (no analysis pipeline)."""

from datetime import datetime

import numpy as np

from sidecar import storage, worker
from sidecar.features import timbre


def test_heatmap_envelope_shape_and_meta():
    matrix = np.zeros((13, 50), dtype=np.float32)
    env = storage.heatmap_envelope(
        timbre.MFCC_HEATMAP, matrix, storage.heatmap_rel("mfcc")
    )
    assert env["render"] == "heatmap"
    assert env["category"] == "timbre"  # from the producing module's metadata
    assert env["shape"] == [13, 50]
    assert env["sidecar"] == "heatmaps/mfcc.npy"
    assert env["axes"] == ["mfcc", "time_frame"]


def test_worker_heatmap_meta_wires_every_producer():
    assert set(worker._HEATMAP_META) == {"spectrogram", "mfcc", "chroma"}


def test_now_is_parseable_iso():
    # Round-trips through fromisoformat, so snapshots carry a valid timestamp.
    parsed = datetime.fromisoformat(worker._now())
    assert parsed.tzinfo is not None
