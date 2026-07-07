"""Pure PANNs helpers (no Cnn14 model load)."""

import numpy as np

from sidecar.features import semantic


def test_axis_track_contrast_and_neutral():
    # Two classes: index 0 = "left" pole, index 1 = "right" pole.
    name_to_ix = {"L": 0, "R": 1}
    framewise = np.array(
        [
            [0.0, 0.0],  # neither pole detected -> neutral 0.5
            [0.0, 1.0],  # right pole only -> 1.0
            [1.0, 0.0],  # left pole only -> 0.0
        ]
    )
    track = semantic._axis_track(framewise, name_to_ix, ["L"], ["R"])
    assert track[0] == 0.5
    assert track[1] == 1.0
    assert track[2] == 0.0
    assert np.all((track >= 0.0) & (track <= 1.0))


def test_load_labels_returns_names():
    labels = semantic._load_labels()
    assert isinstance(labels, list)
    assert len(labels) > 0
    assert all(isinstance(name, str) for name in labels)
