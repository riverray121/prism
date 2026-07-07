"""YouTube import guards (no network — only the local failure paths)."""

import pytest

from sidecar import youtube


def test_missing_ffmpeg_is_an_actionable_error(monkeypatch):
    monkeypatch.setattr(youtube.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="ffmpeg not found"):
        youtube.download("https://example.com/watch?v=x")


def test_empty_download_dir_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(youtube.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    class FakeYDL:
        def __init__(self, options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download):
            return {}

    import yt_dlp

    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYDL)
    with pytest.raises(RuntimeError, match="no audio file"):
        youtube.download("https://example.com/watch?v=x", dest_dir=tmp_path)
