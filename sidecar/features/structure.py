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
# Motif mining: minimum phrase length in cells (~1 bar), occurrence-merge
# overlap fraction, strongest-pairs cap (bounds the clustering cost), and the
# maximum number of motif clusters reported.
MIN_MOTIF_CELLS = 4
MOTIF_OVERLAP = 0.5
MOTIF_PAIR_CAP = 200
MAX_MOTIFS = 8
# A recurrence link only counts as a repeat if its similarity exceeds the SSM
# median by this margin; in a featureless SSM (everything similar to
# everything) no link stands out, so no motifs are mined from it.
MOTIF_CONTRAST = 0.1


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
    # each coefficient across time so all contribute comparably. The absolute
    # floor on the std keeps near-constant rows (e.g. steady tones, silence)
    # from amplifying numerical noise into fake structure; musical MFCC rows
    # vary far above it.
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=20)[1:]
    mfcc = (mfcc - mfcc.mean(axis=1, keepdims=True)) / (
        mfcc.std(axis=1, keepdims=True) + 1.0
    )
    # Aggregate over cells (median is robust to transients). sync splits around
    # the given indices, so passing only the inner boundaries yields exactly one
    # column per cell.
    inner = frames[1:-1]
    chroma_sync = librosa.util.sync(chroma, inner, aggregate=np.median)
    mfcc_sync = librosa.util.sync(mfcc, inner, aggregate=np.median)

    # Stack both views: chroma max-normalized per cell (its usual 0-1 form),
    # z-scored MFCC as-is — already scale-comparable, and near-zero for
    # constant signals (per-cell renormalizing would re-amplify noise there).
    x = np.vstack([librosa.util.normalize(chroma_sync, axis=0), mfcc_sync])
    x = librosa.util.normalize(x, axis=0, norm=2)  # L2-unit columns -> dot = cosine
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


def _boundaries(nov: np.ndarray, n: int) -> np.ndarray:
    """Section boundaries as cell indices (always including 0 and n)."""
    wait = min(MIN_SECTION_CELLS, max(1, n // 4))
    peaks = librosa.util.peak_pick(
        nov,
        pre_max=max(1, wait // 2),
        post_max=max(1, wait // 2),
        pre_avg=wait,
        post_avg=wait,
        delta=0.05,
        wait=wait,
    )
    # Keep clear transitions only, and drop peaks too close to the ends to form
    # a full section.
    peaks = [int(p) for p in peaks if nov[p] >= NOVELTY_MIN and wait <= p <= n - wait]
    return np.array([0, *peaks, n], dtype=int)


def _recurrence(s: np.ndarray) -> np.ndarray:
    """Long-range recurrence links straight from the dense SSM: drop the
    near-diagonal band (trivial self-similarity), keep each row's strongest
    links, then median-filter along time-lag diagonals so repeats survive as
    paths instead of speckle. Shared by section grouping and motif mining."""
    n = s.shape[0]
    width = min(3, max(1, n // 8))
    rec = s.copy()
    offsets = np.abs(np.subtract.outer(np.arange(n), np.arange(n)))
    rec[offsets < width] = 0.0
    k = max(1, int(2 * np.ceil(np.sqrt(n))))
    if n > k:
        thresh = np.partition(rec, n - k, axis=1)[:, n - k][:, None]
        rec[rec < thresh] = 0.0
    rec = np.maximum(rec, rec.T)
    return librosa.segment.timelag_filter(scipy.ndimage.median_filter)(
        rec, size=(1, min(7, n))
    )


def _embedding(s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-cell spectral embedding of the recurrence structure.

    Builds the McFee & Ellis affinity graph (path-smoothed recurrence blended
    with a local time-adjacency link), then returns the eigenvectors and
    eigenvalues of its normalized Laplacian.
    """
    n = s.shape[0]
    rec = _recurrence(s)
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
    seg_vecs = librosa.util.normalize(seg_vecs, axis=1, norm=2)

    centroids, labels = kmeans2(seg_vecs, k, minit="++", seed=1)
    centroids = librosa.util.normalize(centroids, axis=1, norm=2)
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


def _sections_envelope(
    y: np.ndarray, sr: int, s: np.ndarray, grid: np.ndarray, bounds: np.ndarray
) -> dict:
    """Sections as a segment feature: grouped, named spans between boundaries."""
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


def _novelty_envelope(
    nov: np.ndarray, grid: np.ndarray, n_frames: int, frame_rate_hz: float
) -> dict:
    """Per-frame "how new is this?" on the shared timeline: the cell-level
    novelty curve interpolated from cell centers onto the frame grid."""
    frame_times = np.arange(n_frames) / frame_rate_hz
    if len(nov) >= 2:
        centers = (grid[:-1] + grid[1:]) / 2.0
        data = np.interp(frame_times, centers, np.clip(nov, 0.0, 1.0))
    else:
        data = np.zeros(n_frames)
    return {
        "render": "continuous",
        "category": "structure",
        "source": "ssm",
        "unit": "normalized",
        "range": [0, 1],
        "data": [float(x) for x in data],
    }


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True runs in a boolean array, as (start, end) half-open."""
    if not mask.any():
        return []
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(int), [0]))))
    return list(zip(edges[::2], edges[1::2]))


def _motifs(s: np.ndarray, grid: np.ndarray) -> dict:
    """Recurring phrases mined from the recurrence matrix ([WIP]).

    Every sufficiently long diagonal run of recurrence links at lag L means the
    spans [i, j) and [i+L, j+L) repeat each other. Both spans become motif
    occurrences; occurrences are clustered by pair-linkage plus span overlap
    (union-find), and the strongest clusters are reported as M1, M2, ...
    """
    n = s.shape[0]
    occs: list[tuple[int, int, float]] = []  # (start_cell, end_cell, strength)
    pairs: list[tuple[int, int]] = []
    if n > MIN_MOTIF_CELLS:
        rec = _recurrence(s)
        rec = np.where(rec >= float(np.median(s)) + MOTIF_CONTRAST, rec, 0.0)
        found: list[tuple[float, int, int, int]] = []  # (score, i0, length, lag)
        for lag in range(MIN_MOTIF_CELLS, n - MIN_MOTIF_CELLS + 1):
            diag = np.diag(rec, k=lag)
            for r0, r1 in _runs(diag > 0):
                length = min(r1 - r0, lag)  # cap so the two spans can't overlap
                if length < MIN_MOTIF_CELLS:
                    continue
                strength = float(diag[r0 : r0 + length].mean())
                found.append((strength * length, r0, length, lag))
        # Strongest pairs only; bounds the O(m^2) overlap clustering below.
        found.sort(reverse=True)
        for _, i0, length, lag in found[:MOTIF_PAIR_CAP]:
            strength = float(np.diag(rec, k=lag)[i0 : i0 + length].mean())
            a = len(occs)
            occs.append((i0, i0 + length, strength))
            b = len(occs)
            occs.append((i0 + lag, i0 + lag + length, strength))
            pairs.append((a, b))

    # Union-find: same motif if pair-linked or substantially overlapping.
    parent = list(range(len(occs)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        parent[find(i)] = find(j)

    for a, b in pairs:
        union(a, b)
    for i in range(len(occs)):
        for j in range(i + 1, len(occs)):
            lo = max(occs[i][0], occs[j][0])
            hi = min(occs[i][1], occs[j][1])
            shorter = min(occs[i][1] - occs[i][0], occs[j][1] - occs[j][0])
            if hi - lo >= MOTIF_OVERLAP * shorter:
                union(i, j)

    # Merge each cluster's near-duplicate spans into distinct occurrences. Only
    # substantial overlap merges (same criterion as the union step) — touching
    # spans are separate occurrences (e.g. a chorus repeated back-to-back).
    clusters: dict[int, list[tuple[int, int, float]]] = {}
    for i, occ in enumerate(occs):
        clusters.setdefault(find(i), []).append(occ)
    motifs = []
    for members in clusters.values():
        members.sort()
        merged: list[list[float]] = []
        for a, b, w in members:
            if merged:
                pa, pb, pw = merged[-1]
                overlap = min(pb, b) - max(pa, a)
                if overlap >= MOTIF_OVERLAP * min(b - a, pb - pa):
                    merged[-1][1] = max(pb, b)
                    merged[-1][2] = max(pw, w)
                    continue
            merged.append([a, b, w])
        if len(merged) >= 2:
            coverage = sum(b - a for a, b, _ in merged)
            motifs.append((coverage, merged))

    # Strongest clusters, numbered in order of first appearance.
    motifs.sort(reverse=True)
    kept = sorted(motifs[:MAX_MOTIFS], key=lambda m: m[1][0][0])
    segments = [
        {
            "start": float(grid[int(a)]),
            "end": float(grid[int(b)]),
            "label": f"M{idx + 1}",
            "confidence": float(np.clip(w, 0.0, 1.0)),
        }
        for idx, (_, merged) in enumerate(kept)
        for a, b, w in merged
    ]
    segments.sort(key=lambda seg: seg["start"])
    return {
        "render": "segment",
        "category": "structure",
        "source": "ssm",
        "status": "wip",
        "segments": segments,
    }


def structure_features(
    y: np.ndarray, sr: int, beat_times: list[float], n_frames: int, frame_rate_hz: float
) -> dict[str, dict]:
    """Sections, novelty, and motifs from one shared SSM pass.

    ``n_frames``/``frame_rate_hz`` define the shared continuous timeline that
    the novelty curve is resampled onto.
    """
    s, grid = ssm(y, sr, beat_times)
    nov = _novelty_curve(s)
    bounds = _boundaries(nov, s.shape[0])
    return {
        "sections": _sections_envelope(y, sr, s, grid, bounds),
        "novelty": _novelty_envelope(nov, grid, n_frames, frame_rate_hz),
        "motifs": _motifs(s, grid),
    }
