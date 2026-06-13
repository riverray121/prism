"""Outgoing IPC: write one JSON-line event to stdout.

Serialized with a lock because the worker thread and the main stdin thread both
emit; without it their lines could interleave and corrupt the JSON stream.

The real stdout is captured at import and written to directly, so events still
reach the frontend even while the worker thread has globally redirected
``sys.stdout`` (separation suppresses its backends' stray prints that way —
without this, a snapshot emitted on the main thread during a separation would be
swallowed to stderr, e.g. a cancel that appears to do nothing for ~100s).
"""

import sys
import threading

_lock = threading.Lock()
_OUT = sys.stdout


def emit(event: object) -> None:
    line = event.model_dump_json()  # type: ignore[attr-defined]
    with _lock:
        _OUT.write(line + "\n")
        _OUT.flush()
