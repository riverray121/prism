"""YouTube import: download a URL's audio as FLAC for the normal import flow.

Requires the system ``ffmpeg`` (yt-dlp shells out to it for audio extraction);
its absence is reported as a clear import error rather than a crash.
"""

import contextlib
import logging
import shutil
import sys
import tempfile
from pathlib import Path

log = logging.getLogger("sidecar.youtube")

# YouTube's anti-bot challenge message; anonymous downloads sometimes hit it.
# A retry authenticated with the local browser's cookies usually clears it.
_BOT_CHECK = "Sign in to confirm"

# Browser whose cookies the retry borrows. Reading its cookie store may make
# macOS prompt once for Keychain access ("Chrome Safe Storage") — allow it.
_COOKIE_BROWSER = "chrome"


def _run(url: str, options: dict) -> None:
    # Heavy import deferred so sidecar startup doesn't pay for it.
    from yt_dlp import YoutubeDL

    # Guard the stdout JSON-lines IPC channel against any stray prints.
    with contextlib.redirect_stdout(sys.stderr), YoutubeDL(options) as ydl:
        ydl.extract_info(url, download=True)


def download(url: str, dest_dir: Path | None = None) -> Path:
    """Download ``url``'s audio into a FLAC file and return its path.

    The filename is ``{uploader} - {title}.flac`` so the existing
    ``Artist - Title`` metadata heuristic applies on import. Raises RuntimeError
    with an actionable message when ffmpeg is missing; yt-dlp errors propagate.
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
