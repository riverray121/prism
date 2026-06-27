"""Outgoing IPC: write one JSON-line event to stdout.

Serialized with a lock because the worker thread and the main stdin thread both
emit; without it their lines could interleave and corrupt the JSON stream.

The real stdout is captured at import and written to directly, so events still
reach the frontend while a separation has the process-wide ``sys.stdout``
redirected to stderr (a scoped ``contextlib.redirect_stdout`` in separation.py
that suppresses the backends' stray prints). Without the captured handle, a
snapshot emitted on the main thread during a separation would be swallowed to
stderr — e.g. a cancel that appears to do nothing for ~100s.
"""

import sys
import threading
from typing import Protocol

_lock = threading.Lock()
_OUT = sys.stdout


class _Emittable(Protocol):
    def model_dump_json(self) -> str: ...


def emit(event: _Emittable) -> None:
    line = event.model_dump_json()
    with _lock:
        _OUT.write(line + "\n")
        _OUT.flush()
