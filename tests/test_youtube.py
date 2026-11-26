"""YouTube import guards (no network — only the local failure paths)."""

import shutil
import subprocess

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


def test_age_restriction_does_not_borrow_browser_cookies(monkeypatch, tmp_path):
    monkeypatch.setattr(youtube.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    import yt_dlp

    attempts = []
    monkeypatch.setattr(
        yt_dlp,
        "YoutubeDL",
        _ydl_factory(attempts, fail_first_with="Sign in to confirm your age"),
    )
    with pytest.raises(Exception, match="confirm your age"):
        youtube.download("https://example.com/watch?v=x", dest_dir=tmp_path)
    assert len(attempts) == 1


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


def test_primary_artist_is_the_lead_credit():
    assert youtube.primary_artist("jigitz, Lay Bankz") == "jigitz"
    assert youtube.primary_artist(", x") == ", x"


C = youtube.Candidate


def test_version_tags_must_match_the_request_title():
    assert youtube.version_tags("SPILL YOUR TIME (LIVE)") == {"live"}
    assert youtube.version_tags("Song - Slowed + Reverb") == {"slowed", "reverb"}
    assert (
        youtube.version_tags("Delivery (Official Video)") == set()
    )  # "live" inside a word
    studio = [C("u1", "Song (LIVE)", 200, True), C("u2", "Song", 200, False)]
    assert [c.url for c in youtube.rank_candidates(studio, "Song", 200)] == ["u2"]
    live = [C("u1", "Song (LIVE)", 300, False), C("u2", "Song", 200, True)]
    assert [c.url for c in youtube.rank_candidates(live, "Song - Live", 300)] == ["u1"]


def test_a_version_note_naming_a_credited_artist_is_a_credit():
    artist = "Chrystal, NOTION"
    assert youtube.version_tags("CHRYSTAL - The Days (Notion Remix)", artist) == set()
    assert youtube.version_tags(
        "[1 HOUR] Chrystal - The Days (Notion Remix)", artist
    ) == {"hour"}
    assert youtube.version_tags("The Days (Other Remix)", artist) == {"remix"}
    cands = [
        C("lyric", "CHRYSTAL - The Days (Lyric Video)", 173, False),
        C("remix", "The Days (Notion Remix)", 233, False),
    ]
    assert [c.url for c in youtube.rank_candidates(cands, "The Days", 233, artist)] == [
        "remix"
    ]


def test_title_must_name_the_song():
    assert youtube.core_title("Ivy (feat. X) - Remastered 2011") == "ivy"
    assert youtube.title_matches(
        "Everything Goes My Way", "Metronomy - Everything Goes My Way (Official Video)"
    )
    assert not youtube.title_matches("Real Sugar", "Daisy")
    assert not youtube.title_matches("Ivy", "Ivory Tower")
    cands = [C("daisy", "Daisy", 161, True), C("sugar", "Real Sugar", 161, False)]
    assert [c.url for c in youtube.rank_candidates(cands, "Real Sugar", 161)] == [
        "sugar"
    ]


def test_length_picks_the_recording_and_official_wins_ties():
    cands = [
        C("live", '"SPILL YOUR TIME" Live by KatzPascale', 544, False),
        C("ext", "SPILL YOUR TIME (Best Part Extended)", 321, False),
        C("plain", "SPILL YOUR TIME", 194, False),
        C("music", "SPILL YOUR TIME", 192, True),
        C("video", "SPILL YOUR TIME (Official Video)", 250, False),
    ]
    ranked = youtube.rank_candidates(cands, "SPILL YOUR TIME", 193)
    assert [c.url for c in ranked] == ["music", "plain"]


def test_no_close_length_falls_back_within_fifteen_percent_then_nothing():
    cands = [C("a", "Song", 220, False), C("b", "Song", 400, False)]
    assert [c.url for c in youtube.rank_candidates(cands, "Song", 200)] == ["a"]
    assert youtube.rank_candidates([C("b", "Song", 400, False)], "Song", 200) == []


def test_without_a_length_official_results_come_first():
    cands = [
        C("a", "Song", None, False),
        C("b", "Song", None, True),
        C("c", "Song (Live)", None, True),
    ]
    assert [c.url for c in youtube.rank_candidates(cands, "Song", None)] == ["b", "a"]


def test_find_source_uses_the_next_candidate_on_the_third_attempt(monkeypatch):
    cands = [C("first", "Song", 200, True), C("second", "Song", 201, False)]
    monkeypatch.setattr(youtube, "search_candidates", lambda artist, title: cands)
    assert youtube.find_source("A", "Song", 200, 1) == "first"
    assert youtube.find_source("A", "Song", 200, 2) == "first"
    assert youtube.find_source("A", "Song", 200, 3) == "second"
    monkeypatch.setattr(youtube, "search_candidates", lambda artist, title: [])
    with pytest.raises(RuntimeError, match="no YouTube upload matches A - Song, 200 s"):
        youtube.find_source("A", "Song", 200, 1)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_normalize_loudness_brings_a_quiet_file_to_the_target(tmp_path):
    path = tmp_path / "quiet.flac"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=8:sample_rate=48000",
            "-af",
            "volume=-30dB",
            str(path),
        ],
        check=True,
    )
    youtube.normalize_loudness(path)
    probe = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "ebur128",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    integrated = float(probe.stderr.rsplit("I:", 1)[1].split("LUFS")[0])
    assert abs(integrated - youtube.TARGET_LUFS) < 1.0
    rate = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=sample_rate",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert rate == "48000"
