"""Structural features from a shared self-similarity matrix (SSM).

Pipeline (hand-rolled; see build-order M5 slice 2):

  beat-synchronous chroma + MFCC
    -> cosine affinity SSM            (shared: sections now, novelty/motifs in slice 3)
    -> Foote checkerboard novelty     -> section boundaries
    -> Laplacian spectral embedding   -> k-means grouping of the spans
    -> heuristic naming               -> intro/verse/chorus/drop/breakdown/outro

Cells are beat-spans when the beat grid is usable, else a fixed-length grid, so
the SSM stays small (~hundreds of cells) regardless of song length.
"""

import librosa
import numpy as np
import scipy.ndimage
import scipy.signal
from scipy.cluster.vq import kmeans2
from scipy.linalg import eigh

# Analysis hop for structure features; matches librosa's default everywhere a
# frame index must line up (beat frames, chroma, mfcc).
HOP = 512
# Fallback cell length when the beat grid is unusable (too few beats).
CELL_SEC = 0.5
# Checkerboard kernel half-width and the minimum section length, in cells
# (a cell is one beat; 16 beats = 4 bars in 4/4).
KERNEL_CELLS = 16
MIN_SECTION_CELLS = 16
# Cluster-count search range for grouping (eigengap heuristic, clamped).
MIN_K, MAX_K = 2, 8
# Minimum novelty for a boundary, as a fraction of a full-contrast transition
# (novelty is kernel-mass normalized, not peak normalized, so this is absolute;
# a featureless song produces no boundaries instead of amplified noise).
NOVELTY_MIN = 0.05


def _grid_times(duration: float, beat_times: list[float]) -> np.ndarray:
    """Cell boundary times: the beat grid bracketed by [0, duration], or a
    uniform grid when there are too few beats to be meaningful."""
    if len(beat_times) >= 32:
        inner = [t for t in beat_times if 0.5 < t < duration - 0.5]
        return np.array([0.0, *inner, duration])
    n = max(2, int(round(duration / CELL_SEC)))
    return np.linspace(0.0, duration, n + 1)


def ssm(
    y: np.ndarray, sr: int, beat_times: list[float]
) -> tuple[np.ndarray, np.ndarray]:
    """Shared SSM: cell-synchronous chroma+MFCC -> cosine affinity matrix.

    Returns (S, grid) where S is [cells, cells] with values in [0, 1] and grid
    is the cells+1 boundary times. Sections, novelty, and motifs all derive
    from this one matrix.
    """
    duration = len(y) / sr
    frames = librosa.time_to_frames(
        _grid_times(duration, beat_times), sr=sr, hop_length=HOP
    )
    frames = np.unique(np.clip(frames, 0, None))
    # Cell i spans [grid[i], grid[i+1]); rebuild times from the deduped frames
    # so grid and feature columns can't drift apart.
    grid = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
    grid[0], grid[-1] = 0.0, duration

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    # Drop MFCC 0 (overall energy, which would dominate the cosine) and z-score
    # each coefficient across time so all contribute comparably.
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=20)[1:]
    mfcc = (mfcc - mfcc.mean(axis=1, keepdims=True)) / (
        mfcc.std(axis=1, keepdims=True) + 1e-9
    )
    # Aggregate over cells (median is robust to transients). sync splits around
    # the given indices, so passing only the inner boundaries yields exactly one
    # column per cell.
    inner = frames[1:-1]
    chroma_sync = librosa.util.sync(chroma, inner, aggregate=np.median)
    mfcc_sync = librosa.util.sync(mfcc, inner, aggregate=np.median)

    # Stack both views, each feature-normalized so neither dominates the cosine.
    x = np.vstack(
        [
            librosa.util.normalize(chroma_sync, axis=0),
            librosa.util.normalize(mfcc_sync, axis=0),
        ]
    )
    x = librosa.util.normalize(x, axis=0)  # unit columns -> dot = cosine
    s = np.clip(x.T @ x, 0.0, 1.0)
    return s, grid


def _novelty_curve(s: np.ndarray) -> np.ndarray:
    """Foote novelty: correlate a checkerboard Gaussian kernel along the SSM
    diagonal. High values mark transitions between self-similar blocks."""
    n = s.shape[0]
    kw = min(KERNEL_CELLS, max(2, n // 4))
    g = scipy.signal.windows.gaussian(2 * kw, std=kw / 2.0)
    kernel = np.outer(g, g)
    sign = np.ones((2 * kw, 2 * kw))
    sign[:kw, kw:] = -1
    sign[kw:, :kw] = -1
    kernel *= sign

    padded = np.pad(s, kw, mode="edge")
    nov = np.empty(n)
    for i in range(n):
        block = padded[i : i + 2 * kw, i : i + 2 * kw]
        nov[i] = float((block * kernel).sum())
    # Normalize by the kernel's positive mass: 1.0 = a full-contrast transition
    # (identical-within, dissimilar-across). Absolute, unlike peak normalization,
    # so a featureless SSM yields ~0 everywhere rather than rescaled noise.
    pos_mass = kernel[kernel > 0].sum()
    return np.clip(nov, 0.0, None) / pos_mass


def _boundaries(s: np.ndarray) -> np.ndarray:
    """Section boundaries as cell indices (always including 0 and n)."""
    n = s.shape[0]
    nov = _novelty_curve(s)
    wait = min(MIN_SECTION_CELLS, max(1, n // 4))
    peaks = librosa.util.peak_pick(
        nov,
        pre_max=wait // 2,
        post_max=wait // 2,
        pre_avg=wait,
        post_avg=wait,
        delta=0.05,
        wait=wait,
    )
    # Keep clear transitions only, and drop peaks too close to the ends to form
    # a full section.
    peaks = [int(p) for p in peaks if nov[p] >= NOVELTY_MIN and wait <= p <= n - wait]
    return np.array([0, *peaks, n], dtype=int)


def _embedding(s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-cell spectral embedding of the recurrence structure.

    Builds the McFee & Ellis affinity graph (path-smoothed recurrence blended
    with a local time-adjacency link), then returns the eigenvectors and
    eigenvalues of its normalized Laplacian.
    """
    n = s.shape[0]
    # Long-range recurrence links straight from the dense SSM: drop the
    # near-diagonal band (trivial self-similarity), keep each row's strongest
    # links, then median-filter along time-lag diagonals so repeats survive as
    # paths instead of speckle.
    width = min(3, max(1, n // 8))
    rec = s.copy()
    offsets = np.abs(np.subtract.outer(np.arange(n), np.arange(n)))
    rec[offsets < width] = 0.0
    k = max(1, int(2 * np.ceil(np.sqrt(n))))
    if n > k:
        thresh = np.partition(rec, n - k, axis=1)[:, n - k][:, None]
        rec[rec < thresh] = 0.0
    rec = np.maximum(rec, rec.T)
    rec = librosa.segment.timelag_filter(scipy.ndimage.median_filter)(
        rec, size=(1, min(7, n))
    )
    # Local linkage: connect temporal neighbors, weighted by their similarity.
    path = np.diag(np.diag(s, k=1), k=1)
    path = path + path.T
    deg_rec = rec.sum(axis=1)
    deg_path = path.sum(axis=1)
    mu = deg_path.sum() / max(1e-9, (deg_rec + deg_path).sum())
    a = mu * rec + (1 - mu) * path

    deg = a.sum(axis=1)
    inv_sqrt = 1.0 / np.sqrt(np.maximum(deg, 1e-9))
    lap = np.eye(n) - (inv_sqrt[:, None] * a * inv_sqrt[None, :])
    evals, evecs = eigh(lap)
    # Smooth eigenvectors over time; cluster transitions get crisper.
    evecs = scipy.ndimage.median_filter(evecs, size=(min(9, n), 1))
    return evals, evecs


def _choose_k(evals: np.ndarray, n_segments: int) -> int:
    """Cluster count via the eigengap heuristic, clamped to a sane range."""
    hi = min(MAX_K, n_segments)
    if hi <= MIN_K:
        return max(1, hi)
    gaps = np.diff(evals[: hi + 1])
    return int(np.argmax(gaps[MIN_K - 1 : hi]) + MIN_K)


def _group(s: np.ndarray, bounds: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cluster the spans between boundaries. Returns (group_id, confidence)
    per segment; confidence is cosine similarity to the cluster centroid."""
    n_segments = len(bounds) - 1
    if n_segments <= 1:
        return np.zeros(n_segments, dtype=int), np.ones(n_segments)

    evals, evecs = _embedding(s)
    k = _choose_k(evals, n_segments)
    basis = evecs[:, :k]
    # One embedding vector per segment: mean over its cells, unit-normalized.
    seg_vecs = np.array(
        [basis[a:b].mean(axis=0) for a, b in zip(bounds[:-1], bounds[1:])]
    )
    seg_vecs = librosa.util.normalize(seg_vecs, axis=1)

    centroids, labels = kmeans2(seg_vecs, k, minit="++", seed=1)
    centroids = librosa.util.normalize(centroids, axis=1)
    conf = np.clip((seg_vecs * centroids[labels]).sum(axis=1), 0.0, 1.0)
    return labels, conf


def _name_groups(
    bounds_sec: np.ndarray, groups: np.ndarray, energies: np.ndarray
) -> list[str]:
    """Map cluster ids to section names on audio cues.

    Recurring groups: the most energetic is the chorus, the rest are verses.
    One-off segments: first -> intro, last -> outro, otherwise drop/breakdown
    by energy against the song median.
    """
    n = len(groups)
    counts = np.bincount(groups)
    group_energy = {
        g: float(energies[groups == g].mean()) for g in range(len(counts)) if counts[g]
    }
    recurring = [g for g in group_energy if counts[g] >= 2]
    chorus = max(recurring, key=lambda g: group_energy[g]) if recurring else None
    median_energy = float(np.median(energies)) if n else 0.0

    names = []
    for i, g in enumerate(groups):
        if counts[g] >= 2:
            names.append("chorus" if g == chorus else "verse")
        elif i == 0:
            names.append("intro")
        elif i == n - 1:
            names.append("outro")
        else:
            names.append("drop" if energies[i] >= median_energy else "breakdown")
    return names


def sections(y: np.ndarray, sr: int, beat_times: list[float]) -> dict:
    """Song sections as a segment feature: SSM boundaries + grouped, named spans."""
    s, grid = ssm(y, sr, beat_times)
    bounds = _boundaries(s)
    bounds_sec = grid[bounds]
    groups, conf = _group(s, bounds)

    # Mean RMS energy per segment, for the naming heuristic.
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    rms_times = librosa.times_like(rms, sr=sr, hop_length=HOP)
    energies = np.array(
        [
            float(rms[(rms_times >= a) & (rms_times < b)].mean()) if b > a else 0.0
            for a, b in zip(bounds_sec[:-1], bounds_sec[1:])
        ]
    )
    names = _name_groups(bounds_sec, groups, energies)

    segments = [
        {
            "start": float(a),
            "end": float(b),
            "label": names[i],
            "group": chr(ord("A") + int(groups[i])),
            "confidence": float(conf[i]),
        }
        for i, (a, b) in enumerate(zip(bounds_sec[:-1], bounds_sec[1:]))
    ]
    # A single span means no structure was found; an honest single segment.
    if len(segments) == 1:
        segments[0]["label"] = "song"
    return {
        "render": "segment",
        "category": "structure",
        "source": "ssm",
        "segments": segments,
    }
