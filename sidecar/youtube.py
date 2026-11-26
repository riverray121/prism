"""YouTube import: download a URL's audio as FLAC for the normal import flow.

Requires the system ``ffmpeg`` (yt-dlp shells out to it for audio extraction);
its absence is reported as a clear import error rather than a crash.

Companion requests name a track, not a video, so ``find_source`` picks the
upload that is that track: candidates come from YouTube Music's song results
(official audio, the same masters streaming services carry) and a regular
YouTube search, and only a candidate with the same version tags as the
request title (live, remix, slowed...) and, when the request carries the
track's length, a length within ``LENGTH_TOLERANCE`` is taken. The first hit
of a plain search is often a live recording or a music-video edit.
"""

import contextlib
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urlparse

log = logging.getLogger("sidecar.youtube")

# YouTube's anti-bot challenge message; anonymous downloads sometimes hit it.
# A retry authenticated with the local browser's cookies usually clears it.
# Only this check: "Sign in to confirm your age" (age-restricted videos) is
# not fixed by cookies of a browser that is not signed in, and every retry
# raises the Keychain prompt.
_BOT_CHECK = "not a bot"

# Browser whose cookies the retry borrows. Reading its cookie store may make
# macOS prompt once for Keychain access ("Chrome Safe Storage") — allow it.
_COOKIE_BROWSER = "chrome"


def _run(url: str, options: dict, download: bool = True) -> dict:
    # Heavy import deferred so sidecar startup doesn't pay for it.
    from yt_dlp import YoutubeDL

    # Guard the stdout JSON-lines IPC channel against any stray prints.
    with contextlib.redirect_stdout(sys.stderr), YoutubeDL(options) as ydl:
        return ydl.extract_info(url, download=download) or {}


def _info(url: str, options: dict) -> dict:
    """Metadata without downloading. Never borrows browser cookies: reading
    them raises a macOS Keychain prompt on the Mac's screen, and a search
    can skip a result it cannot read."""
    return _run(url, options, download=False)


def primary_artist(artist: str) -> str:
    """The first credited artist. Feature credits joined with commas ("jigitz,
    Lay Bankz") make YouTube's search return nothing; the lead name alone
    finds the song."""
    return artist.split(",")[0].strip() or artist.strip()


# Words that mark a recording as a different version of a song. A candidate
# must carry exactly the request title's set: a studio request skips live and
# remix uploads, a live request takes only a live one.
VERSION_TAGS = (
    "live",
    "remix",
    "cover",
    "acoustic",
    "instrumental",
    "karaoke",
    "sped up",
    "slowed",
    "reverb",
    "nightcore",
    "extended",
    "edit",
    "demo",
    "mashup",
    "8d",
    "hour",
    "loop",
)
# A candidate's length must be within this of the requested track's length:
# max(seconds, fraction of the length).
LENGTH_TOLERANCE = (3.0, 0.03)
# Without any candidate inside the tolerance, the closest one within this
# fraction is taken (a re-upload with a few seconds of silence, an intro).
LENGTH_FALLBACK = 0.15
SEARCH_RESULTS = 8
CHECKED_WITHOUT_LENGTH = 4  # YouTube Music results whose length is fetched one by one


@dataclass
class Candidate:
    url: str
    title: str
    duration: float | None
    official: bool  # a YouTube Music song result


def version_tags(title: str, artist: str = "") -> set[str]:
    """Version words in a title. A bracketed note or dash segment that names
    one of the track's own credited artists is a credit, not a different
    version: Spotify titles NOTION's remix of "The Days" plainly, credited to
    "Chrystal, NOTION", while uploads say "The Days (NOTION Remix)"."""
    names = [n for n in (_words(a).strip() for a in artist.split(",")) if n]
    parts = re.split(r"(\([^)]*\)|\[[^\]]*\]|\s[-\u2013\u2014]\s)", title)
    kept = [p for p in parts if not any(f" {n} " in _words(p) for n in names)]
    t = _words(" ".join(kept))
    return {tag for tag in VERSION_TAGS if f" {tag} " in t}


def _words(text: str) -> str:
    return " " + " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split()) + " "


def core_title(title: str) -> str:
    """The song's name without bracketed notes and dash suffixes:
    "Ivy (feat. X) - Remastered 2011" becomes "Ivy"."""
    t = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", title)
    t = re.split(r"\s[-\u2013\u2014]\s", t)[0]
    return _words(t).strip() or _words(title).strip()


def title_matches(request_title: str, candidate_title: str) -> bool:
    """The candidate names the requested song: its words contain the
    request's core title. A same-length upload of another song fails here."""
    return f" {core_title(request_title)} " in _words(candidate_title)


def video_id(url: str) -> str | None:
    q = parse_qs(urlparse(url).query).get("v")
    return q[0] if q else None


def rank_candidates(
    candidates: list[Candidate], title: str, duration_s: float | None, artist: str = ""
) -> list[Candidate]:
    """Candidates that are the requested track, best first."""
    wanted = version_tags(title, artist)
    same_version = [
        c
        for c in candidates
        if version_tags(c.title, artist) == wanted and title_matches(title, c.title)
    ]
    if duration_s is None:
        return sorted(same_version, key=lambda c: not c.official)
    tol = max(LENGTH_TOLERANCE[0], LENGTH_TOLERANCE[1] * duration_s)
    timed = [c for c in same_version if c.duration is not None]
    close = [c for c in timed if abs(c.duration - duration_s) <= tol]
    if close:
        return sorted(
            close, key=lambda c: (not c.official, abs(c.duration - duration_s))
        )
    near = [
        c for c in timed if abs(c.duration - duration_s) <= LENGTH_FALLBACK * duration_s
    ]
    if near:
        log.warning(
            "no upload of %r within %.0f s of %.0f s; taking the closest",
            title,
            tol,
            duration_s,
        )
    return sorted(near, key=lambda c: abs(c.duration - duration_s))


def search_candidates(artist: str, title: str) -> list[Candidate]:
    """YouTube Music song results, then regular search results, without
    duplicates. YouTube Music's listing has no lengths; they come from the
    regular results for the same video, or a per-video lookup."""
    from yt_dlp.utils import DownloadError

    query = f"{primary_artist(artist)} {title}"
    flat = {
        "quiet": True,
        "extract_flat": True,
        "playlistend": SEARCH_RESULTS,
        "logger": log,
    }
    music = _info(f"https://music.youtube.com/search?q={quote_plus(query)}#songs", flat)
    plain = _info(f"ytsearch{SEARCH_RESULTS}:{query}", flat)
    lengths: dict[str, float] = {}
    out: list[Candidate] = []
    for e in plain.get("entries") or []:
        vid = e.get("id") or video_id(e.get("url", ""))
        if vid and e.get("duration"):
            lengths[vid] = float(e["duration"])
    seen: set[str] = set()
    checked = 0
    for e in music.get("entries") or []:
        vid = e.get("id") or video_id(e.get("url", ""))
        if not vid or vid in seen:
            continue
        seen.add(vid)
        duration = e.get("duration") or lengths.get(vid)
        if (
            duration is None
            and checked < CHECKED_WITHOUT_LENGTH
            and version_tags(e.get("title", ""), artist) == version_tags(title, artist)
        ):
            checked += 1
            try:
                info = _info(
                    f"https://www.youtube.com/watch?v={vid}",
                    {"quiet": True, "logger": log},
                )
                duration = info.get("duration")
            except DownloadError as exc:
                # Age-restricted or removed: ranked without a length.
                log.info("no length for %s: %s", vid, str(exc).splitlines()[0][:120])
        out.append(
            Candidate(
                f"https://www.youtube.com/watch?v={vid}",
                e.get("title", ""),
                float(duration) if duration else None,
                official=True,
            )
        )
    for e in plain.get("entries") or []:
        vid = e.get("id") or video_id(e.get("url", ""))
        if not vid or vid in seen:
            continue
        seen.add(vid)
        out.append(
            Candidate(
                f"https://www.youtube.com/watch?v={vid}",
                e.get("title", ""),
                lengths.get(vid),
                official=False,
            )
        )
    return out


def find_source(artist: str, title: str, duration_s: float | None, attempt: int) -> str:
    """The video URL to import for a request. The first two attempts take the
    best candidate (a failed download is often transient); later attempts
    take the next one, for a song whose best upload has no usable audio."""
    ranked = rank_candidates(
        search_candidates(artist, title), title, duration_s, artist
    )
    if not ranked:
        length = f", {duration_s:.0f} s" if duration_s else ""
        raise RuntimeError(f"no YouTube upload matches {artist} - {title}{length}")
    pick = ranked[min(0 if attempt <= 2 else 1, len(ranked) - 1)]
    log.info(
        "source for %s - %s: %s (%s, %s s)",
        artist,
        title,
        pick.url,
        pick.title,
        pick.duration,
    )
    return pick.url


# Loudness every import is brought to, so shows play at the same volume.
TARGET_LUFS = -14.0
TRUE_PEAK = -1.0


def normalize_loudness(path: Path) -> None:
    """Two-pass ffmpeg loudnorm in linear mode: one gain for the whole file,
    so the song's dynamics stay as mastered."""
    target = f"I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA=11"
    measure = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            f"loudnorm={target}:print_format=json",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    err = measure.stderr
    stats = json.loads(err[err.rindex("{") : err.rindex("}") + 1])
    # loudnorm resamples to 192 kHz internally; write the source's rate back.
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    rate = probe.stdout.strip() or "44100"
    out = path.with_suffix(".norm.flac")
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-y",
            "-i",
            str(path),
            "-af",
            (
                f"loudnorm={target}:linear=true:measured_I={stats['input_i']}"
                f":measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}"
                f":measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}"
            ),
            "-ar",
            rate,
            str(out),
        ],
        capture_output=True,
        check=True,
    )
    out.replace(path)


def download(url: str, dest_dir: Path | None = None, *, rank: int = 1) -> Path:
    """Download ``url``'s audio into a FLAC file and return its path.

    The filename is ``{uploader} - {title}.flac`` so the existing
    ``Artist - Title`` metadata heuristic applies on import. For a search URL,
    ``rank`` picks which result to download. Raises RuntimeError with an
    actionable message when ffmpeg is missing; yt-dlp errors propagate.
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg not found — install it (brew install ffmpeg) to import from YouTube"
        )
    out_dir = dest_dir or Path(tempfile.mkdtemp(prefix="prism-yt-"))
    options = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "%(uploader)s - %(title)s.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "flac"}],
        "quiet": True,
        "playlist_items": str(rank),
        "noprogress": True,
        "logger": log,
    }
    try:
        _run(url, options)
    except Exception as exc:
        if _BOT_CHECK not in str(exc):
            raise
        log.info("bot check hit; retrying with %s cookies", _COOKIE_BROWSER)
        _run(url, {**options, "cookiesfrombrowser": (_COOKIE_BROWSER,)})
    flacs = sorted(out_dir.glob("*.flac"))
    if not flacs:
        raise RuntimeError("download produced no audio file")
    return flacs[0]
