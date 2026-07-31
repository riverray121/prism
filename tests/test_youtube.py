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


def _ydl_factory(attempts, fail_first_with=None):
    """FakeYDL recording each construction's options; optionally the first
    attempt's extract_info raises."""

    class FakeYDL:
        def __init__(self, options):
            attempts.append(options)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download):
            if fail_first_with is not None and len(attempts) == 1:
                raise RuntimeError(fail_first_with)
            return {}

    return FakeYDL


def test_bot_check_retries_with_browser_cookies(monkeypatch, tmp_path):
    monkeypatch.setattr(youtube.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    import yt_dlp

    attempts = []
    monkeypatch.setattr(
        yt_dlp,
        "YoutubeDL",
        _ydl_factory(attempts, fail_first_with="Sign in to confirm you're not a bot"),
    )
    (tmp_path / "a.flac").touch()
    path = youtube.download("https://example.com/watch?v=x", dest_dir=tmp_path)
    assert path.name == "a.flac"
    assert len(attempts) == 2
    assert "cookiesfrombrowser" not in attempts[0]
    assert attempts[1]["cookiesfrombrowser"] == ("chrome",)


def test_other_errors_do_not_retry(monkeypatch, tmp_path):
    monkeypatch.setattr(youtube.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    import yt_dlp

    attempts = []
    monkeypatch.setattr(
        yt_dlp, "YoutubeDL", _ydl_factory(attempts, fail_first_with="Video unavailable")
    )
    with pytest.raises(Exception, match="Video unavailable"):
        youtube.download("https://example.com/watch?v=x", dest_dir=tmp_path)
    assert len(attempts) == 1
