"""Per-song mapping doc persistence: ``songs/{uuid}/mapping/mapping.json``.

The sidecar stores the doc as-is (light validation only — the frontend owns
the schema); writes are atomic, mirroring profile.json.
"""

import json
import logging

from . import storage

log = logging.getLogger("sidecar")


def read_mapping(song_id: str) -> dict | None:
    """Read a song's mapping doc. None when absent (song starts blank) or
    unreadable (a corrupt doc must not sever the command channel)."""
    path = storage.SONGS_DIR / song_id / "mapping" / "mapping.json"
    try:
        doc = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        log.warning("malformed mapping doc for %s", song_id)
        return None
    if not isinstance(doc, dict):
        log.warning("mapping doc for %s is not an object", song_id)
        return None
    return doc


def write_mapping(song_id: str, doc: dict) -> None:
    """Atomically replace a song's mapping doc, creating ``mapping/`` as needed."""
    path = storage.SONGS_DIR / song_id / "mapping" / "mapping.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    storage.write_json_atomic(path, doc)
