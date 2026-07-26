"""Pure structure helpers (no SSM pipeline, no audio)."""

import numpy as np

from sidecar.features import structure


def test_runs_finds_contiguous_true_spans():
    mask = np.array([0, 1, 1, 0, 1, 0], dtype=bool)
    assert structure._runs(mask) == [(1, 3), (4, 5)]


def test_runs_empty_and_all_true():
    assert structure._runs(np.zeros(5, dtype=bool)) == []
    assert structure._runs(np.ones(3, dtype=bool)) == [(0, 3)]


def test_grid_times_uniform_branch_for_few_beats():
    # Under 32 beats: a uniform grid bracketed by [0, duration].
    grid = structure._grid_times(10.0, beat_times=[1.0, 2.0])
    assert grid[0] == 0.0
    assert grid[-1] == 10.0
    assert np.all(np.diff(grid) > 0)  # strictly increasing


def test_grid_times_beat_branch_brackets_inner_beats():
    beats = list(np.linspace(0.6, 9.4, 40))  # >= 32 beats
    grid = structure._grid_times(10.0, beat_times=beats)
    assert grid[0] == 0.0 and grid[-1] == 10.0
    # Inner boundaries are the beats strictly inside (0.5, duration - 0.5).
    assert len(grid) == len([t for t in beats if 0.5 < t < 9.5]) + 2


def test_name_groups_labels_chorus_and_bookends():
    # Two clusters: group 0 recurs and is most energetic (chorus); the lone
    # group 1 in the middle is a one-off. First/last recurring slots still get
    # section names; ends of one-offs become intro/outro.
    groups = np.array([0, 1, 0, 0])
    energies = np.array([0.9, 0.2, 0.9, 0.9])
    names = structure._name_groups(groups, energies)
    assert names[0] == "chorus"  # recurring + most energetic
    assert names[1] in ("drop", "breakdown")  # one-off in the middle


def test_novelty_curve_peaks_at_block_boundary():
    # A 2-block diagonal SSM: novelty should peak near the block change.
    n = 20
    s = np.zeros((n, n))
    s[:10, :10] = 1.0
    s[10:, 10:] = 1.0
    nov = structure._novelty_curve(s)
    assert nov.shape == (n,)
    assert np.argmax(nov) in range(7, 13)  # near the midpoint boundary
