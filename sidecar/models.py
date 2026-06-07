"""Download-on-first-run registry for pretrained model weights.

Weights are large opaque binaries and never live in git (see docs/dev-log.md).
Each model is fetched on first use into a gitignored cache in the app-data dir
and checksum-verified, so a truncated or tampered download fails loudly instead
of corrupting analysis downstream. ``ensure(name)`` returns the local path,
downloading only if the file is missing or its hash does not match.
"""

import hashlib
import logging
import os
import tempfile
import urllib.request
from pathlib import Path

log = logging.getLogger("sidecar.models")

# Cache dir for downloaded weights. App-data dir on macOS; overridable for tests
# and packaged builds (where Tauri resolves the real app-data path).
MODELS_DIR = Path(
    os.environ.get(
        "PRISM_MODELS_DIR",
        Path.home() / "Library" / "Application Support" / "Prism" / "models",
    )
)

# name -> source URL, expected sha256, and cache filename.
_REGISTRY = {
    "btc_large_voca": {
        "url": "https://github.com/riverray121/prism/releases/download/models-v1/btc_model_large_voca.pt",
        "sha256": "1673d23f8f9a55ae7f9e8b80a51da616debb22675b8d8b67ea6ce0ef37b0ab51",
        "filename": "btc_model_large_voca.pt",
    },
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure(name: str) -> Path:
    """Return the local path to model ``name``, downloading + verifying if needed."""
    entry = _REGISTRY[name]
    dest = MODELS_DIR / entry["filename"]
    if dest.exists() and _sha256(dest) == entry["sha256"]:
        return dest

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    log.info("downloading model %s from %s", name, entry["url"])
    # Download to a temp file in the same dir, then atomically rename once verified.
    fd, tmp_name = tempfile.mkstemp(dir=MODELS_DIR, suffix=".part")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(entry["url"]) as resp:
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        actual = _sha256(tmp)
        if actual != entry["sha256"]:
            raise ValueError(
                f"checksum mismatch for {name}: expected {entry['sha256']}, got {actual}"
            )
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)
    log.info("model %s ready at %s", name, dest)
    return dest
