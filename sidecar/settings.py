"""Analysis-settings resolution: selected engines + drum sub-separation.

The one place raw persisted values (library.py's JSON key-value store) meet the
available engine set: defaults, validation, and canonical ordering live here,
so library.py stores raw JSON only and no caller re-validates.
"""

import sqlite3

from . import library, separation


def get_engines(con: sqlite3.Connection) -> list[str]:
    """Separation engines selected for analysis, in canonical order.

    Defaults to ``separation.DEFAULT_ENGINES`` when unset. Invalid/removed
    engine ids in the saved selection are dropped; an empty selection means
    mix-only.
    """
    available = list(separation.ENGINES)
    selected = library.get_setting(con, "engines", None)
    if selected is None:
        return [e for e in separation.DEFAULT_ENGINES if e in available]
    chosen = set(selected)
    return [e for e in available if e in chosen]


def set_engines(con: sqlite3.Connection, engines: list[str]) -> None:
    """Persist an engine selection, dropping unknown ids (the frontend may lag
    the available set)."""
    library.set_setting(con, "engines", [e for e in engines if e in separation.ENGINES])


def get_drum_subsep(con: sqlite3.Connection) -> bool:
    """Whether to sub-separate drums stems into kick/snare/etc. Default off
    (extra model + time per drums stem)."""
    return bool(library.get_setting(con, "drum_subsep", False))


def set_drum_subsep(con: sqlite3.Connection, on: bool) -> None:
    library.set_setting(con, "drum_subsep", bool(on))
