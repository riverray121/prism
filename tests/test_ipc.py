"""Outgoing IPC framing: one newline-terminated JSON line per event."""

import io

from sidecar import ipc


class _FakeEvent:
    def model_dump_json(self) -> str:
        return '{"type":"test"}'


def test_emit_writes_single_json_line(monkeypatch):
    buf = io.StringIO()
    monkeypatch.setattr(ipc, "_OUT", buf)
    ipc.emit(_FakeEvent())
    out = buf.getvalue()
    assert out == '{"type":"test"}\n'
    assert out.count("\n") == 1
