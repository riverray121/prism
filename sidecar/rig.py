"""App-level rig persistence: ``library/rig.json`` (known hubs + named lights).

The sidecar stores the doc as-is (the frontend owns the schema); writes are
atomic, mirroring mapping.json. Discovery results are runtime state and never
land here — only hub identities, user names, and last-known addresses.
"""

import json
import logging

from . import storage

log = logging.getLogger("sidecar")

EMPTY_RIG: dict = {"hubs": []}


def _path():
    return storage.LIBRARY_ROOT / "rig.json"


def read_rig() -> dict:
    """Read the rig doc. The empty rig when absent (first run) or unreadable
    (a corrupt doc must not sever the command channel)."""
    try:
        doc = json.loads(_path().read_text())
    except FileNotFoundError:
        return dict(EMPTY_RIG)
    except json.JSONDecodeError:
        log.warning("malformed rig.json")
        return dict(EMPTY_RIG)
    if not isinstance(doc, dict):
        log.warning("rig.json is not an object")
        return dict(EMPTY_RIG)
    return doc


def write_rig(doc: dict) -> None:
    """Atomically replace the rig doc, creating the library dir as needed."""
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    storage.write_json_atomic(path, doc)
