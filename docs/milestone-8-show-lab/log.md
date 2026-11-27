# Show Lab — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

- Slice 0 — Models: Beat This! beats/downbeats (CPU, ~1.5 s per song, checkpoint in the model registry), `bs_roformer_sw` engine, `sidecar/lab.py` fetch/analyze/list on `--library`, `storage.set_library_root`.

## Todo

- [x] Slice 0 — Models
- [ ] Slice 1 — Algorithm contract and v1
- [ ] Slice 2 — Palettes
- [ ] Slice 3 — Ranking and v2
- [ ] Slice 4 — Lab generate and report
- [ ] Slice 5 — Simulator core and Sim tab
- [ ] Slice 6 — Headless render
- [ ] Slice 7 — v3 roles
- [ ] Slice 8 — Mapping refresh
- [ ] Slice 9 — Corpus comparison

## Notes

- prism-player recolors shows on playlists that declare a palette (`palettes.py`, indie-dusk). Its recolor keeps each pixel's value and replaces the color, so a Prism palette on such a show is overridden on the Pi.
- The lab corpus lives in `eval-library/` (gitignored), analyzed with every engine plus drum sub-separation.
