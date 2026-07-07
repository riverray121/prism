"""Pure worker helpers (no analysis pipeline)."""

from datetime import datetime

import numpy as np

from sidecar import worker


def test_heatmap_envelope_shape_and_meta():
    matrix = np.zeros((13, 50), dtype=np.float32)
    env = worker._heatmap_envelope("mfcc", matrix, "heatmaps/mfcc.npy")
    assert env["render"] == "heatmap"
    assert env["category"] == "timbre"  # from _HEATMAP_META["mfcc"]
    assert env["shape"] == [13, 50]
    assert env["sidecar"] == "heatmaps/mfcc.npy"
    assert env["axes"] == ["mfcc", "time_frame"]


def test_now_is_parseable_iso():
    # Round-trips through fromisoformat, so snapshots carry a valid timestamp.
    parsed = datetime.fromisoformat(worker._now())
    assert parsed.tzinfo is not None
