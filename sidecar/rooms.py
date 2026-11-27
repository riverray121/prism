"""Simulator persistence: rooms and per-song room shows.

Rooms are app-level: ``library/rooms/{id}.json``, one file per room (title,
size, placed items). A room show is per song and per room:
``songs/{uuid}/mapping/sim.json`` holds ``{"rooms": {room_id: show}}``, where a
show is the programs, derivations, patch, macro, palette and generator a show
algorithm produced for that room's lights. Both are stored as-is (the frontend
owns the schemas); writes are atomic, mirroring mapping.json.
"""

import json
import logging
import re

from . import storage

log = logging.getLogger("sidecar")

# Room ids become file names; anything outside this set is refused so an id
# can never escape the rooms directory.
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _rooms_dir():
    return storage.LIBRARY_ROOT / "rooms"


def _room_path(room_id: str):
    if not _ID_RE.match(room_id):
        raise ValueError(f"invalid room id: {room_id!r}")
    return _rooms_dir() / f"{room_id}.json"


def list_rooms() -> list[dict]:
    """Every readable room, ordered by title. A malformed file is skipped
    (logged) so one bad room cannot hide the rest."""
    directory = _rooms_dir()
    if not directory.exists():
        return []
    rooms: list[dict] = []
    for path in sorted(directory.glob("*.json")):
        try:
            doc = json.loads(path.read_text())
        except json.JSONDecodeError:
            log.warning("malformed room file %s", path.name)
            continue
        if not isinstance(doc, dict):
            log.warning("room file %s is not an object", path.name)
            continue
        doc["id"] = path.stem
        rooms.append(doc)
    rooms.sort(key=lambda r: str(r.get("title", "")).lower())
    return rooms


def save_room(room: dict) -> None:
    """Atomically write one room under its ``id``."""
    path = _room_path(str(room.get("id", "")))
    path.parent.mkdir(parents=True, exist_ok=True)
    storage.write_json_atomic(path, room)


def delete_room(room_id: str) -> None:
    _room_path(room_id).unlink(missing_ok=True)


def _sim_path(song_id: str):
    return storage.SONGS_DIR / song_id / "mapping" / "sim.json"


def read_sim(song_id: str) -> dict:
    """A song's room shows; the empty doc when absent or unreadable."""
    try:
        doc = json.loads(_sim_path(song_id).read_text())
    except FileNotFoundError:
        return {"rooms": {}}
    except json.JSONDecodeError:
        log.warning("malformed sim.json for %s", song_id)
        return {"rooms": {}}
    if not isinstance(doc, dict) or not isinstance(doc.get("rooms"), dict):
        log.warning("sim.json for %s has no rooms object", song_id)
        return {"rooms": {}}
    return doc


def write_sim(song_id: str, doc: dict) -> None:
    """Atomically replace a song's sim doc, creating ``mapping/`` as needed."""
    path = _sim_path(song_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    storage.write_json_atomic(path, doc)
