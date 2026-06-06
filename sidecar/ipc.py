"""Outgoing IPC: write one JSON-line event to stdout.

Serialized with a lock because the worker thread and the main stdin thread both
emit; without it their lines could interleave and corrupt the JSON stream.
"""

import sys
import threading

_lock = threading.Lock()


def emit(event: object) -> None:
    line = event.model_dump_json()  # type: ignore[attr-defined]
    with _lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
