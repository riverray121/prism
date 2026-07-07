"""Default onset derivation from continuous features.

Every continuous feature gets a default onset track at analysis time: peaks of
the (min-max normalized) signal above a fixed cutoff, at least a minimum
interval apart. These are fixed-parameter defaults for display; user-tunable
derivations are a mapping-stage concept and live outside the profile.
"""

import numpy as np
from scipy.signal import find_peaks

# Fraction of the feature's own range a peak must clear.
DEFAULT_CUTOFF = 0.3
# Two peaks closer than this collapse into the higher one.
MIN_SEPARATION_SEC = 0.1


def onsets_from(
    data: list[float] | np.ndarray,
    frame_rate_hz: float,
    *,
    cutoff: float = DEFAULT_CUTOFF,
    min_separation_sec: float = MIN_SEPARATION_SEC,
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
    distance = max(1, round(min_separation_sec * frame_rate_hz))
    indices, _ = find_peaks(norm, height=cutoff, distance=distance)
    return [
        {
            "t": round(float(i) / frame_rate_hz, 4),
            "strength": round(float(norm[i]), 4),
        }
        for i in indices
    ]


def attach_onsets(feature_map: dict[str, dict], frame_rate_hz: float) -> None:
    """Add a default ``onsets`` list to every continuous envelope, in place."""
    for envelope in feature_map.values():
        if envelope.get("render") == "continuous":
            envelope["onsets"] = onsets_from(envelope["data"], frame_rate_hz)
