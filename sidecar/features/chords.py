"""Chord recognition via the vendored BTC bi-directional Transformer.

Replicates the inference pipeline of BTC-ISMIR19's ``test.py`` (large-voca, 170
classes) on an in-memory signal: blocked CQT -> log-magnitude -> per-block
checkpoint normalization -> 108-frame Transformer blocks -> per-frame chord
argmax, run-length-encoded into chord-change events. The model and its weights
load once per process and are cached.
"""

import logging

import librosa
import numpy as np
import torch

from .. import models
from ..vendor.btc.btc_model import BTC_model

log = logging.getLogger("sidecar.features.chords")

# BTC feature/model hyperparameters for the large-vocabulary checkpoint
# (from the upstream run_config.yaml; large_voca branch).
SONG_HZ = 22050
INST_LEN = 10.0  # seconds per CQT block
N_BINS = 144
BINS_PER_OCTAVE = 24
HOP_LENGTH = 2048
TIMESTEP = 108  # frames per Transformer block

_MODEL_CONFIG = {
    "feature_size": N_BINS,
    "timestep": TIMESTEP,
    "num_chords": 170,
    "input_dropout": 0.2,
    "layer_dropout": 0.2,
    "attention_dropout": 0.2,
    "relu_dropout": 0.2,
    "num_layers": 8,
    "num_heads": 4,
    "hidden_size": 128,
    "total_key_depth": 128,
    "total_value_depth": 128,
    "filter_size": 128,
    "loss": "ce",
    "probs_out": False,
}

# Large-voca label table: indices 0..167 are 12 roots x 14 qualities; 168='X'
# (unknown), 169='N' (no chord). Mirrors idx2voca_chord() in BTC's utils.
_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_QUALITIES = [
    "min",
    "maj",
    "dim",
    "aug",
    "min6",
    "maj6",
    "min7",
    "minmaj7",
    "maj7",
    "7",
    "dim7",
    "hdim7",
    "sus2",
    "sus4",
]

# Per-process cache of the loaded model plus its normalization statistics.
_loaded: tuple[BTC_model, float, float] | None = None


def _idx_to_chord(idx: int) -> tuple[str, str]:
    """Map a class index to (root, quality). 'N'/'X' carry an empty quality."""
    if idx == 169:
        return "N", ""
    if idx == 168:
        return "X", ""
    return _ROOTS[idx // 14], _QUALITIES[idx % 14]


def _load_model() -> tuple[BTC_model, float, float]:
    global _loaded
    if _loaded is not None:
        return _loaded
    ckpt_path = models.ensure("btc_large_voca")
    checkpoint = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    model = BTC_model(config=_MODEL_CONFIG)
    model.load_state_dict(checkpoint["model"])
    # probs_out makes the output layer return logits so we can recover per-frame
    # softmax confidence (the default path returns only argmax indices).
    model.output_layer.probs_out = True
    model.eval()
    _loaded = (model, float(checkpoint["mean"]), float(checkpoint["std"]))
    return _loaded


def _cqt_features(y: np.ndarray) -> np.ndarray:
    """Blocked log-magnitude CQT, shape [frames, N_BINS]. Matches BTC's blocking."""
    block = int(SONG_HZ * INST_LEN)
    pieces = []
    for start in range(0, len(y), block):
        seg = y[start : start + block]
        if len(seg) == 0:
            continue
        pieces.append(
            librosa.cqt(
                seg,
                sr=SONG_HZ,
                n_bins=N_BINS,
                bins_per_octave=BINS_PER_OCTAVE,
                hop_length=HOP_LENGTH,
            )
        )
    cqt = np.concatenate(pieces, axis=1)
    feature = np.log(np.abs(cqt) + 1e-6)
    return feature.T  # [frames, bins]


def compute_chords(y: np.ndarray, sr: int) -> dict:
    """Run BTC chord recognition; return the ``chords`` event-feature envelope."""
    if sr != SONG_HZ:
        y = librosa.resample(y, orig_sr=sr, target_sr=SONG_HZ)

    model, mean, std = _load_model()

    feature = (_cqt_features(y) - mean) / std
    n_real = feature.shape[0]
    # Pad time to a whole number of Transformer blocks.
    pad = TIMESTEP - (n_real % TIMESTEP)
    if pad != TIMESTEP:
        feature = np.pad(feature, ((0, pad), (0, 0)), mode="constant")

    x = torch.tensor(feature, dtype=torch.float32).unsqueeze(0)
    preds = np.empty(feature.shape[0], dtype=np.int64)
    confs = np.empty(feature.shape[0], dtype=np.float32)
    with torch.no_grad():
        for t in range(feature.shape[0] // TIMESTEP):
            block = x[:, TIMESTEP * t : TIMESTEP * (t + 1), :]
            attn_out, _ = model.self_attn_layers(block)
            logits = model.output_layer(attn_out)
            probs = torch.softmax(logits, dim=-1).squeeze(0)
            conf, pred = probs.max(dim=-1)
            preds[TIMESTEP * t : TIMESTEP * (t + 1)] = pred.numpy()
            confs[TIMESTEP * t : TIMESTEP * (t + 1)] = conf.numpy()

    # Run-length-encode real frames into chord-change events; per-event confidence
    # is the mean softmax probability over the frames in that chord's run.
    time_unit = INST_LEN / TIMESTEP
    events = []
    run_start = 0
    for i in range(1, n_real + 1):
        if i == n_real or preds[i] != preds[run_start]:
            root, quality = _idx_to_chord(int(preds[run_start]))
            events.append(
                {
                    "t": float(run_start * time_unit),
                    "root": root,
                    "quality": quality,
                    "confidence": float(confs[run_start:i].mean()),
                }
            )
            run_start = i

    return {
        "render": "event",
        "category": "tonal",
        "source": "btc",
        "events": events,
    }
