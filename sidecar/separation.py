"""Stem separation via ``audio-separator``.

A thin wrapper over audio-separator's many backends (Demucs, MDX, RoFormer, …) so
the worker never sees library internals: ``separate(source, out_dir, engine)``
runs one engine and writes its native stem set as canonical lowercase WAVs
(``vocals.wav`` …) into ``out_dir``, returning ``{stem: path}``. Model weights
auto-download into the shared model cache (``models.MODELS_DIR``), matching the
M3 download-on-first-run pattern.

The engine set is config: ``DEFAULT_ENGINES`` lists which engines run per song.
Slice 1 is a single engine (htdemucs_ft, Demucs on MPS); more engines slot into
``ENGINES`` behind this same interface.
"""

import contextlib
import logging
import re
import sys
from pathlib import Path

from . import models

log = logging.getLogger("sidecar.separation")

# Engine id -> audio-separator model filename. The id is the key used on disk
# (stems/{engine}/) and in the profile (stems.{engine}). The RoFormers run on the
# Apple GPU via torch/MPS (MDXC architecture) and emit vocals/instrumental;
# htdemucs_ft emits vocals/drums/bass/other.
ENGINES = {
    "htdemucs_ft": "htdemucs_ft.yaml",
    "bs_roformer": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    "mel_band_roformer": "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt",
}

# Engines run per song, in order. Kept on disk side-by-side for comparison; the
# ensemble preset is a planned fast-follow.
DEFAULT_ENGINES = ["htdemucs_ft", "bs_roformer", "mel_band_roformer"]

# audio-separator's default output filename is ``{input}_(Vocals)_{model}.wav``;
# this pulls the stem label out of the parenthesized group.
_STEM_RE = re.compile(r"_\(([^)]+)\)_")


def separate(source: Path, out_dir: Path, engine: str) -> dict[str, Path]:
    """Separate ``source`` with one ``engine`` into ``out_dir``; return {stem: path}.

    Stems are written as canonical lowercase WAVs (``{stem}.wav``). ``out_dir`` is
    created if missing. Raises KeyError for an unknown engine.
    """
    # Heavy import (torch/onnxruntime backends) deferred to first separation.
    from audio_separator.separator import Separator

    model_filename = ENGINES[engine]
    out_dir.mkdir(parents=True, exist_ok=True)

    sep = Separator(
        model_file_dir=str(models.MODELS_DIR),
        output_dir=str(out_dir),
        output_format="WAV",
    )
    sep.load_model(model_filename=model_filename)
    # audio-separator logs to stderr, but guard the stdout IPC channel against any
    # stray prints from the underlying separation backends.
    with contextlib.redirect_stdout(sys.stderr):
        outputs = sep.separate(str(source))

    # Rename each output to a canonical lowercase stem name so downstream paths
    # are uniform across engines (stems.{engine}.{stem}).
    stems: dict[str, Path] = {}
    for name in outputs:
        src = out_dir / name
        match = _STEM_RE.search(name)
        stem = (match.group(1) if match else Path(name).stem).lower()
        dest = out_dir / f"{stem}.wav"
        if src.resolve() != dest.resolve():
            src.replace(dest)
        stems[stem] = dest
    log.info("separated %s with %s -> %s", source.name, engine, sorted(stems))
    return stems
