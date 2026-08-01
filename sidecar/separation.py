"""Stem separation via ``audio-separator``.

A thin wrapper over audio-separator's many backends (Demucs, MDX, RoFormer, …) so
the worker never sees library internals: ``separate(source, out_dir, engine)``
runs one engine and writes its native stem set as canonical lowercase WAVs
(``vocals.wav`` …) into ``out_dir``, returning ``{stem: path}``. Model weights
download on first run into the shared model cache (``models.MODELS_DIR``).

``ENGINES`` is the full set of available engines; which ones actually run per song
is a user setting (see ``settings.get_engines``). New engines slot into ``ENGINES``
behind this same interface.
"""

import contextlib
import logging
import re
import sys
from pathlib import Path

from . import models

log = logging.getLogger("sidecar.separation")

# Engine id -> audio-separator model filename. The id is the key used on disk
# (stems/{engine}/) and in the profile (stems.{engine}). All run on the Apple GPU
# via torch/MPS. htdemucs_ft emits vocals/drums/bass/other; htdemucs_6s adds
# guitar/piano; the RoFormers (MDXC architecture) emit vocals/instrumental.
ENGINES = {
    "htdemucs_ft": "htdemucs_ft.yaml",
    "htdemucs_6s": "htdemucs_6s.yaml",
    "bs_roformer": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    "mel_band_roformer": "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt",
}

# UI-facing metadata per engine: display label + whether it emits a `drums`
# stem (the capability drum sub-separation needs). Sent to the frontend so
# nothing about engines is hard-coded there.
ENGINE_INFO = {
    "htdemucs_ft": {
        "label": "Demucs (htdemucs_ft) — vocals/drums/bass/other",
        "drums": True,
    },
    "htdemucs_6s": {
        "label": "Demucs 6-stem (htdemucs_6s) — + guitar/piano",
        "drums": True,
    },
    "bs_roformer": {
        "label": "BS-RoFormer — vocals/instrumental",
        "drums": False,
    },
    "mel_band_roformer": {
        "label": "Mel-Band RoFormer — vocals/instrumental",
        "drums": False,
    },
}

# Engines selected by default (when the user hasn't chosen a set). Just the
# fine-tuned 4-stem Demucs — the others are opt-in via Analysis settings, since
# they add cost and the RoFormers/6-stem overlap its stems.
DEFAULT_ENGINES = ["htdemucs_ft"]

# Drum-separation model: splits a drums stem into kick/snare/toms/hh/ride/crash.
# Run as a second stage on an engine's ``drums`` stem (see worker drum sub-sep).
DRUM_SEP_MODEL = "MDX23C-DrumSep-aufr33-jarredou.ckpt"

# audio-separator's default output filename is ``{input}_(Vocals)_{model}.wav``;
# this pulls the stem label out of the parenthesized group.
_STEM_RE = re.compile(r"_\(([^)]+)\)_")


def _run_separator(source: Path, out_dir: Path, model_filename: str) -> dict[str, Path]:
    """Separate ``source`` with one model into ``out_dir``; return {stem: path}.

    Stems are written as canonical lowercase WAVs (``{stem}.wav``). ``out_dir`` is
    created if missing. The shared core behind ``separate`` (top-level engines) and
    ``separate_drums`` (drum sub-separation).
    """
    # Heavy import (torch/onnxruntime backends) deferred to first separation.
    from audio_separator.separator import Separator

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
    # are uniform across engines (stems.{engine}.{stem}). Whitespace in a label
    # (e.g. "No Vocals") collapses to '_' so it can't break the {stem}.wav path or
    # the stem_name == "drums" sub-sep branch.
    stems: dict[str, Path] = {}
    for name in outputs:
        src = out_dir / name
        match = _STEM_RE.search(name)
        label = match.group(1) if match else Path(name).stem
        stem = re.sub(r"\s+", "_", label.strip()).lower()
        # Two outputs canonicalizing to the same key would silently drop a stem.
        if stem in stems:
            raise ValueError(f"stem name collision: {stem!r} from {name!r}")
        dest = out_dir / f"{stem}.wav"
        if src.resolve() != dest.resolve():
            src.replace(dest)
        stems[stem] = dest
    return stems


def separate(source: Path, out_dir: Path, engine: str) -> dict[str, Path]:
    """Separate ``source`` with one ``engine`` into ``out_dir``; return {stem: path}.

    Raises KeyError for an unknown engine.
    """
    stems = _run_separator(source, out_dir, ENGINES[engine])
    log.info("separated %s with %s -> %s", source.name, engine, sorted(stems))
    return stems


def separate_drums(drums_path: Path, out_dir: Path) -> dict[str, Path]:
    """Sub-separate a drums stem into kick/snare/toms/hh/ride/crash into ``out_dir``."""
    stems = _run_separator(drums_path, out_dir, DRUM_SEP_MODEL)
    log.info("drum sub-separation -> %s", sorted(stems))
    return stems
