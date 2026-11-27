"""Room and sim.json persistence against tmp_path (never the real library)."""

import json

import pytest

from sidecar import rooms

ROOM = {
    "id": "living",
    "title": "Living room",
    "size": {"w": 6, "d": 5, "h": 2.7},
    "items": [{"id": "tv", "type": "tv", "position": [0, 1.4, -2.45]}],
}


def test_save_list_round_trip(library_root):
    rooms.save_room(ROOM)
    assert rooms.list_rooms() == [ROOM]


def test_list_missing_dir_is_empty(library_root):
    assert rooms.list_rooms() == []


def test_list_orders_by_title_and_skips_bad_files(library_root):
    rooms.save_room({**ROOM, "id": "b", "title": "Bedroom"})
    rooms.save_room({**ROOM, "id": "a", "title": "attic"})
    (library_root / "rooms" / "broken.json").write_text("{nope")
    (library_root / "rooms" / "list.json").write_text(json.dumps([1]))
    assert [r["title"] for r in rooms.list_rooms()] == ["attic", "Bedroom"]


def test_file_name_is_the_id(library_root):
    rooms.save_room({**ROOM, "id": "x1"})
    (path,) = (library_root / "rooms").glob("*.json")
    assert path.name == "x1.json"


def test_save_replaces_and_delete_removes(library_root):
    rooms.save_room(ROOM)
    rooms.save_room({**ROOM, "title": "Den"})
    assert [r["title"] for r in rooms.list_rooms()] == ["Den"]
    rooms.delete_room("living")
    assert rooms.list_rooms() == []
    rooms.delete_room("living")  # deleting a missing room is a no-op


@pytest.mark.parametrize("bad", ["", "../x", "a/b", "a.b", "x" * 65])
def test_invalid_ids_are_refused(library_root, bad):
    with pytest.raises(ValueError):
        rooms.save_room({**ROOM, "id": bad})
    with pytest.raises(ValueError):
        rooms.delete_room(bad)


SIM = {"rooms": {"living": {"programs": [], "patch": {"tv-strip": "p1"}}}}


def test_sim_round_trip(library_root):
    rooms.write_sim("song1", SIM)
    assert rooms.read_sim("song1") == SIM
    assert (library_root / "songs" / "song1" / "mapping" / "sim.json").exists()


def test_sim_missing_or_bad_reads_empty(library_root):
    assert rooms.read_sim("nope") == {"rooms": {}}
    path = library_root / "songs" / "s" / "mapping" / "sim.json"
    path.parent.mkdir(parents=True)
    path.write_text("{bad")
    assert rooms.read_sim("s") == {"rooms": {}}
    path.write_text(json.dumps({"rooms": []}))
    assert rooms.read_sim("s") == {"rooms": {}}
