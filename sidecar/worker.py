"""Single background worker that analyzes queued songs sequentially.

The queue is the set of songs rows with status='queued', oldest first. The
worker claims one, runs the analysis stages, and writes status + profile.json.
M1 runs only the BPM stage. No cross-song parallelism.
"""

import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone

from . import library, storage
from .features import rhythm

log = logging.getLogger("sidecar.worker")

# Seconds to wait between queue polls when idle.
POLL_INTERVAL = 1.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _claim_next() -> dict | None:
    """Claim the oldest queued song, flipping it to 'analyzing'. Sole consumer."""
    with library.connect() as con:
        row = library.next_queued(con)
        if row is None:
            return None
        library.mark_analyzing(con, row["id"])
    return dict(row)


def _process(song: dict, on_change: Callable[[], None]) -> None:
    song_id = song["id"]
    on_change()  # reflect 'analyzing'
    try:
        audio_path = storage.LIBRARY_ROOT / song["source_path"]
        bpm = rhythm.compute_bpm(audio_path)
        analyzed_at = _now()
        storage.write_profile(song, bpm=bpm, analyzed_at=analyzed_at)
        with library.connect() as con:
            library.mark_analyzed(con, song_id, analyzed_at)
        log.info("analyzed %s bpm=%.1f", song_id, bpm)
    except Exception as exc:
        log.exception("analysis failed: %s", song_id)
        with library.connect() as con:
            library.mark_failed(con, song_id, str(exc))
    on_change()  # reflect 'analyzed' or 'failed'


def run(on_change: Callable[[], None]) -> None:
    """Loop forever, analyzing queued songs. on_change fires after each status change."""
    log.info("worker started")
    while True:
        song = _claim_next()
        if song is None:
            time.sleep(POLL_INTERVAL)
            continue
        _process(song, on_change)
