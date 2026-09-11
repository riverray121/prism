"""Show bundle packing and upload (docs/companion-api.md)."""

import io
import json
import zipfile

import pytest

from sidecar import companion, library, settings


@pytest.fixture
def song(library_root):
    song_dir = library_root / "songs" / "s1"
    (song_dir / "features").mkdir(parents=True)
    (song_dir / "mapping").mkdir()
    (song_dir / "stems" / "e").mkdir(parents=True)
    (song_dir / "show" / "frames").mkdir(parents=True)
    (song_dir / "source.flac").write_bytes(b"AUDIO")
    (song_dir / "profile.json").write_text("{}")
    (song_dir / "features" / "a.npy").write_bytes(b"NPY")
    (song_dir / "mapping" / "mapping.json").write_text("{}")
    (song_dir / "stems" / "e" / "drums.flac").write_bytes(b"BIG")
    (song_dir / "show" / "frames" / "aa-0.bin").write_bytes(bytes(2 * 3 * 3))
    return song_dir


MANIFEST = {
    "schema": "prism-show/1",
    "title": "t",
    "artist": "a",
    "duration_s": 0.05,
    "audio": "audio.flac",
    "source_file": "source.flac",
    "frame_rate_hz": 40,
    "frame_count": 2,
    "latency_ms": 90,
    "lights": [
        {
            "key": "aa-0",
            "hub_mac": "aa",
            "output": 0,
            "name": "Output 1",
            "pixel_count": 3,
            "frames": "frames/aa-0.bin",
        }
    ],
    "external": {},
    "prism_version": "0.1.0",
}


def test_pack_layout(song, tmp_path):
    dest = tmp_path / "show.zip"
    companion.pack("s1", MANIFEST, dest)
    with zipfile.ZipFile(dest) as zf:
        names = sorted(zf.namelist())
        assert names == [
            "audio.flac",
            "frames/aa-0.bin",
            "manifest.json",
            "project/features/a.npy",
            "project/mapping/mapping.json",
            "project/profile.json",
        ]
        assert zf.read("audio.flac") == b"AUDIO"
        assert len(zf.read("frames/aa-0.bin")) == 18
        assert json.loads(zf.read("manifest.json"))["schema"] == "prism-show/1"


def test_publish_uploads_and_marks_request(song, monkeypatch, con):
    monkeypatch.setattr(library, "connect", lambda: _ctx(con))
    settings.set_companion(con, "http://pi:8760", "tok")
    library.insert_song(
        con,
        song_id="s1",
        title="t",
        artist="a",
        duration_sec=None,
        sample_rate=None,
        source_path="songs/s1/source.flac",
        imported_at="now",
    )
    library.link_request(con, "s1", "r1", {"spotify_uri": "spotify:track:x"})
    calls = []

    def fake_urlopen(req, timeout):
        calls.append(req)
        body = {"id": "s1", "title": "t"} if req.get_method() == "PUT" else {}
        return io.BytesIO(json.dumps(body).encode())

    monkeypatch.setattr(companion.urllib.request, "urlopen", fake_urlopen)
    show = companion.publish("s1", MANIFEST)
    assert show == {"id": "s1", "title": "t"}
    put, patch = calls
    assert put.full_url == "http://pi:8760/v1/shows/s1"
    assert put.get_header("Authorization") == "Bearer tok"
    assert put.get_header("Content-type") == "application/zip"
    assert patch.get_method() == "PATCH"
    assert patch.full_url == "http://pi:8760/v1/requests/r1"
    assert json.loads(patch.data) == {"status": "published", "show_id": "s1"}
    assert library.get_link(con, "s1")["published_at"] is not None


def test_publish_without_companion_fails(song, monkeypatch, con):
    monkeypatch.setattr(library, "connect", lambda: _ctx(con))
    with pytest.raises(RuntimeError, match="no companion"):
        companion.publish("s1", MANIFEST)


class _ctx:
    def __init__(self, con):
        self.con = con

    def __enter__(self):
        return self.con

    def __exit__(self, *exc):
        return False
