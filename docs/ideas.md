# Ideas Backlog

Unscoped possibilities not yet committed to a milestone. Distinct from:

- `build-order.md` Milestone 6 — aspirational/`[WIP]` features that already have a home.
- `feature-catalog.md` "Open items" — unresolved decisions for catalogued features.
- `design-doc.md` "Next Steps" — downstream pipeline stages (mapping tool, hardware controller).

Promote an item here to a milestone in `build-order.md` once it's committed.

---

## Aspirational / `[WIP]` features

Heuristic or model-uncommitted features — implement a v1 proxy or drop:

- `valence`, `tension` — emotional axes; no committed model (likely PANNs embeddings + a
  small mapping, or a separate pretrained model).
- `swing` — mean offset of off-beats from the grid; proxy algorithm.
- `harmonic_complexity` — chord-novelty / tension proxy.
- `reverb_amount` — approximate heuristic, low confidence.
- `roughness` — dissonance; needs essentia (AGPL) — use a librosa proxy or drop.

---

## Color palettes

Select from or create named palettes of colors that go well together; swapping a palette
remaps the visualizer config automatically.

---

## Music Source Restoration (MSR)

[`ModistAndrew/xlance-msr`](https://github.com/ModistAndrew/xlance-msr) — XLANCELAB's
top-ranked submission to the Music Source Restoration Challenge 2025.

MSR goes beyond separation: instead of only isolating a source, it **restores fidelity lost
to compression or degradation** in each stem — recovering detail a separator would carry
through unchanged. A natural post-separation stage: separate → restore each stem → analyze
the restored audio (and keep the restored stems for comparison).

- MIT license; PyTorch (built on the MSRKit framework).
- Pretrained weights on Hugging Face (`chenxie95/xlance-msr-ckpt`); demo Space available.
- Cost: another torch model family + weights; restoration is heavier than the DSP passes.
  Validate quality and Apple-Silicon (MPS) feasibility before committing, as with the M4
  separation engines.
