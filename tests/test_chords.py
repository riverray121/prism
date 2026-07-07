"""Chord index mapping and the sub-hop early return (no BTC model load)."""

import numpy as np

from sidecar.features import chords


def test_idx_to_chord_special_tokens():
    assert chords._idx_to_chord(169) == ("N", "")  # no chord
    assert chords._idx_to_chord(168) == ("X", "")  # unknown chord


def test_idx_to_chord_normal_index():
    root, quality = chords._idx_to_chord(0)
    assert root == "C"
    assert quality == chords._QUALITIES[0]


def test_compute_chords_returns_empty_for_sub_hop_signal():
    # Shorter than one hop: returns an empty event feature without loading weights.
    out = chords.compute_chords(
        np.zeros(chords.HOP_LENGTH - 1, dtype=np.float32), 22050
    )
    assert out["render"] == "event"
    assert out["events"] == []
