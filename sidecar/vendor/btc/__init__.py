"""Vendored model code from BTC-ISMIR19 (bi-directional Transformer for chord
recognition).

Source: https://github.com/jayg996/BTC-ISMIR19 (commit on `master`), MIT License
(see LICENSE in this directory). Copyright (c) 2019 Jonggwon Park.

Only the model definition is vendored (`btc_model.py`, `transformer_modules.py`).
Edits from upstream: imports made package-relative; the training `__main__` block
and unused `HParams` import dropped (config is passed as a plain dict);
`np.float` (removed in numpy 2.x) replaced with `float`. Feature
extraction, the chord vocabulary, and inference live in
``sidecar/features/chords.py``, not here.
"""
