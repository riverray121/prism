"""Default onset derivation from continuous features.

Every continuous feature gets two default onset tracks at analysis time, both
peak-picked from the min-max normalized signal:

- ``dense`` — every local maximum above the cutoff at least a short interval
  apart. On sustained/noisy peaks this yields runs of dots that trace the
  duration of the sound.
- ``strict`` — prominent maxima only: a peak must additionally rise
  ``STRICT_PROMINENCE`` above its surroundings, with a wider separation, so a
  noisy hump registers as one onset instead of several.

These are fixed-parameter defaults for display; user-tunable derivations are a
mapping-stage concept and live outside the profile.
"""

import numpy as np
from scipy.signal import find_peaks

# Fraction of the feature's own range a peak must clear.
DEFAULT_CUTOFF = 0.3
# Dense mode: two peaks closer than this collapse into the higher one.
MIN_SEPARATION_SEC = 0.1
# Strict mode: required rise above the surrounding envelope (normalized units),
# and a wider separation window.
STRICT_PROMINENCE = 0.15
STRICT_SEPARATION_SEC = 0.25


def onsets_from(
    data: list[float] | np.ndarray,
    frame_rate_hz: float,
    *,
    cutoff: float = DEFAULT_CUTOFF,
    mode: str = "dense",
) -> list[dict]:
    """Peak-pick a continuous track into ``[{t, strength}]`` onset events.

    ``strength`` is the normalized (0-1) peak height. A flat signal has no
    peaks. Values are rounded so the profile JSON stays compact.
    """
    arr = np.asarray(data, dtype=np.float64)
    if arr.size < 3:
        return []
    lo = float(arr.min())
    hi = float(arr.max())
    if hi - lo <= 0:
        return []
    norm = (arr - lo) / (hi - lo)
    if mode == "strict":
        distance = max(1, round(STRICT_SEPARATION_SEC * frame_rate_hz))
        indices, _ = find_peaks(
            norm, height=cutoff, distance=distance, prominence=STRICT_PROMINENCE
        )
    else:
        distance = max(1, round(MIN_SEPARATION_SEC * frame_rate_hz))
        indices, _ = find_peaks(norm, height=cutoff, distance=distance)
    return [
        {
            "t": round(float(i) / frame_rate_hz, 4),
            "strength": round(float(norm[i]), 4),
        }
        for i in indices
    ]


def attach_onsets(feature_map: dict[str, dict], frame_rate_hz: float) -> None:
    """Add both default onset tracks to every continuous envelope, in place."""
    for envelope in feature_map.values():
        if envelope.get("render") == "continuous":
            envelope["onsets"] = onsets_from(envelope["data"], frame_rate_hz)
            envelope["onsets_strict"] = onsets_from(
                envelope["data"], frame_rate_hz, mode="strict"
            )
