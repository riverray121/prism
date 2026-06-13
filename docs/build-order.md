# Build Order

How to actually build the app. Companion to `design-doc.md`, `feature-catalog.md`, and `profile-schema.md`.

## Philosophy

Walking skeleton. Build the thinnest end-to-end path through every component first (M1), then layer features in (M2+). Slice vertically — don't finish the backend before starting the frontend. You won't know if anything fits together until you try.

---

## Milestone 0 — Scaffolding

Empty window that can talk to a Python process.

- Tauri project scaffold (TypeScript frontend, Rust shell)
- Python sidecar spawned via Tauri's built-in sidecar mechanism
- stdin/stdout JSON-line round-trip: frontend sends `{"type": "ping"}`, backend echoes
- Python deps managed with **uv** (fast, simple env/package manager)

Deliverable: nothing user-visible; plumbing works.

---

## Milestone 1 — Magic moment

Import → analyze → play → see a graph move in sync.

Build in this order — each step is a vertical slice:

1. **SQLite + import** — `library.db` with `songs` table. Import command (mutagen for metadata, copy file under `library/songs/{uuid}/`). Library panel lists imported songs.
2. **Worker + BPM stage** — Python worker pulls `queued` rows. Compute BPM only. Write `profile.json` with just the `bpm` field. Status flips `queued → analyzing → analyzed`.
3. **Inspection view (text)** — open an analyzed song. Show BPM as text.
4. **Add RMS** — second feature. Inspection view renders it as a line graph (uPlot).
5. **Playback + playhead** — Web Audio API plays the source file. Vertical line sweeps the RMS graph in sync.

**Explicitly not in M1:** favorites, metadata editing, stems, Demucs, sidecar files, event/segment/heatmap render modes, cancellation, restart logic, error UI beyond "row marked failed."

Deliverable: a working build of Prism with two features. Validates the full stack.

---

## Milestone 2 — Fill out mix-level DSP

The cheap, dependency-light mix-level features from `feature-catalog.md`. **Done:**

- `beats` — first `event` feature (ticks)
- `spectrogram`, `mfcc`, `chroma` — `heatmap` features via the `.npy` sidecar pipeline
- band energy (6 bands), spectral centroid/flux/flatness/rolloff, key (+ confidence, tuning), LUFS, peak, dynamic range, ZCR, stereo width — plus `bpm`/`rms` from M1

Render modes covered: `scalar`, `continuous`, `event`, `heatmap` (`segment` arrives in M5).

**No UI design work in M2.** Each feature renders into the existing minimal stacked-graph layout — just enough to confirm the data is correct. All UI/UX design (the dashboard: shared time axis, shared zoom/playhead, Y-axis dropdown, and consolidating the per-graph interaction code) is deferred to a single redesign in M6. Do not build the dashboard incrementally here.

**Reassigned out of M2** (clean exit — every catalog feature has a home):

- `chords` (event) → **M3**, via the BTC transformer (PyTorch) — torch enters here.
- `downbeats` (event) → **M3** — needs `madmom` or an alternative; decided alongside chords.
- `silence` (segment), `rhythmic_density` (continuous) → **M5** — `silence` introduces the `segment` render mode, which lands with `sections`.
- `swing`, `harmonic_complexity`, `reverb_amount`, `roughness` (`[WIP]`; `roughness` needs essentia/AGPL) → **`ideas.md`** — aspirational/refinement, unscoped.
- `sections`/`motifs`/`novelty` and PANNs `sound_tags`/`timbral_axes` (ML) → **M5** (already planned).
- `valence`/`tension` (`[WIP]` emotional ML) → **`ideas.md`** — aspirational, unscoped.

Deliverable: complete mix-level DSP for everything cheap and dependency-light; deeper-dependency, segment-mode, ML, and WIP features reassigned above.

---

## Milestone 3 — Chords + downbeats (PyTorch enters)

First trained model in the pipeline. Both features are mix-level and run inside the existing single-pass DSP-mix stage — no multi-stage worker yet (that lands with Demucs in M4). This milestone exists to introduce and de-risk the torch dependency on a light, fast model before the heavier Demucs stage.

- **`chords` (event), via the BTC transformer** ([jayg996/BTC-ISMIR19](https://github.com/jayg996/BTC-ISMIR19), MIT, 12 MB checkpoint, CPU-fine). Vendor `btc_model.py` + its helpers; features are a librosa CQT (n_bins 144, bins/oct 24, hop 2048, 22050 Hz); large-voca = 170 chord classes → `{t, root, quality, confidence}`. Renders on the existing `EventGraph` tick lane.
- **`downbeats` (event) — librosa-based heuristic.** Derive downbeats from the M2 beat grid: assume 4/4 and pick the bar-start phase by scoring each of the four candidate phases against musical cues (onset strength, low-frequency/kick energy, harmonic change at bar boundaries). No new dependency, runs off data we already compute. Chosen over madmom (py3.12 / M-series build friction — the reason Python is pinned) and a torch downbeat model. Accuracy is weaker on meter changes / pickup bars; see the dev-log note for future upgrade paths if it proves inadequate.
- Add `torch` to the sidecar deps; keep running from source. (App freezing/packaging is out of development scope — see the packaging note in dev-log.)
- **Model weights: download-on-first-run into a local cache; never in git.** Build a small `sidecar/models.py` registry — `{name, url, sha256, dest}` per model — and an `ensure(model)` that checks the cache, downloads + checksum-verifies if missing, and fails loudly on mismatch. Cache dir lives in the app-data dir (`~/Library/Application Support/Prism/models/` on macOS), gitignored. The BTC checkpoint (~12 MB) is the only model needing this hand-rolled in M3 (it's vendored code, not a pip package); mirror it to a GitHub Release on our own repo and point the registry there so we control the URL. The M4 separation engines (via `audio-separator`) and PANNs (M5) auto-download and cache their own weights — reuse this pattern only for parity (point their cache at the same dir, e.g. `audio-separator`'s `model_file_dir`); don't reimplement their fetch.

Deliverable: chords + downbeats rendering against playback; torch in the dependency set and de-risked.

---

## Milestone 4 — Multi-engine stem separation + per-stem DSP

First long-running stage; introduces the multi-stage worker. Sub-progress and failure handling matter here. The goal is **maximum separation quality plus side-by-side comparison across engines** — speed is not a constraint.

- **Multi-stage worker.** Refactor the single-pass worker into ordered stages (`dsp-mix → separate → dsp-stem`). Surface progress: extend the `library.songs` snapshot with `current_stage` / `current_stage_progress` (keeps the UI a pure function of snapshots, matching the existing model) rather than a parallel `job.*` event stream. The `separate` stage iterates the configured engine set, so the snapshot also carries which engine is currently running.
- **Separation via `audio-separator`** ([nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)) — one interface over Demucs, MDX, MDX23C/MDXC, VR, and RoFormer (BS-RoFormer / Mel-Band RoFormer), with automatic model download/caching. Wrap it behind a thin sidecar `Separator` interface (input mix → `{stem: array}`) so the engine set is swappable and the worker never sees library internals.
- **Run a configured _set_ of engines per song, not one.** Quality-first default set: Demucs (`htdemucs_ft`) + top RoFormer checkpoints (BS-RoFormer, Mel-Band RoFormer) — exact members are config, tuned by comparing outputs. Each engine writes its native stem set to `library/songs/{uuid}/stems/{engine}/`; progress wired from each engine's callback.
- **Keep every engine's stems on disk.** No cleanup pass in v1 — all engine outputs are retained for ongoing A/B (audio and downstream features). Storage grows ~N× with the engine count; revisit pruning later.
- Per-stem DSP features (energy, onsets, transients, centroid, MFCC; pitch for melodic stems; vibrato for vocals) — reuse the mix extractors per stem, for every engine; write under `stems.{engine}.{stem}.features`.
- **Model weights** auto-download via `audio-separator`'s own cache; point its `model_file_dir` at the shared app-data model dir from M3 (`sidecar/models.py`).
- Failure handling end-to-end: kill the sidecar mid-separation and confirm the "Analysis interrupted" startup logic works; clean up the partial song folder on failure.
- Cancellation of queued songs.
- Dashboard: stem section grouped by engine, per-stem features comparable across engines (reuse existing graph components).
- **6-stem separation.** Add Demucs `htdemucs_6s` to the engine set — it splits into vocals/drums/bass/**guitar**/**piano**/other (two more melodic stems than the 4-stem default). Drops into the `ENGINES` config like any other engine; the wider stem set flows through the existing per-stem DSP pass and UI unchanged.
- **Drum sub-separation (later slice).** A second separation stage applied to a `drums` stem, splitting it into kick/snare/toms/hh/ride/crash via `MDX23C-DrumSep-aufr33-jarredou.ckpt`. Requires the `Separator` interface to accept a stem WAV as input and a sub-stem level in the schema (`stems/{engine}/drums/{sub}.wav`); only runs for engines that emit a `drums` stem (Demucs). The same per-stem DSP pass applies to each sub-stem.

**Apple Silicon acceleration.** `audio-separator` accelerates on the Apple GPU via ONNX Runtime's CoreML provider (M1+, macOS Sonoma+); Demucs uses MPS. If CoreML/MPS proves flaky for the RoFormer/MDX engines, [`mlx-audio-separator`](https://github.com/ssmall256/mlx-audio-separator) (MLX-native, same engine families, ~1.85× faster, near drop-in) is the fallback backend — slot it behind the same `Separator` interface. Speed is not a goal; this is only about getting the engines running on-GPU at all.

Deliverable: full DSP pipeline including stems from multiple separation engines, retained for comparison.

---

## Milestone 5 — ML classification + structure

The semantic/structural layer: what's sounding, how the song is built, what repeats. All mix-level. Introduces the `segment` render mode (the last of the five) and PANNs.

Build in this order:

- **Slice 0 — de-risk dependencies. Done.** Both `msaf` and PANNs run on Python 3.12 / arm64 (see dev-log). Outcome: PANNs is clean; `msaf` works only with runtime shims for removed scipy APIs and drags a ~15-package unmaintained dep tail. **Decision: sections are hand-rolled on a shared SSM, not msaf** — slice 3 needs the SSM anyway, and msaf can't share its internals. The msaf shim recipe (dev-log) is the escape hatch if hand-rolled quality disappoints.
- **Slice 1 — `segment` render mode + `silence`.** Build and de-risk the new render mode end-to-end (storage shape `{start, end, label, attrs}` + a frontend segment lane) on the cheapest feature before any ML touches it. `silence` (regions below threshold) is the vehicle.
- **Slice 2 — `sections` (hand-rolled SSM).** The headline structural feature; rides the segment mode. Boundaries from Foote checkerboard-kernel novelty over a librosa recurrence matrix (chroma/MFCC); grouping via spectral clustering on the recurrence graph (librosa documents this approach; scikit-learn is the only candidate new dep). Pure audio structure — mapping generic groups to named labels (intro/verse/chorus/drop/breakdown/outro) is a heuristic pass on audio cues, not lyrics.
- **Slice 3 — `novelty` + `motifs`.** Both derive from the same self-similarity matrix as sections. **Compute the SSM once and share it** across sections, novelty, and motifs rather than recomputing per feature. `novelty` = per-frame "how new is this?"; `motifs` (`[WIP]`) = clustered recurring phrases, algorithm TBD.
- **Slice 4 — PANNs `sound_tags`** (+ `rhythmic_density`, trivial continuous — slot it wherever). Model download + caching via the M3 registry; pick the ~20–40-class music-relevant subset of the 527 AudioSet labels.
- **Slice 5 — `timbral_axes` + confidence rendering. Done.** Realized timbral_axes as three curated continuous axes (`electronic_organic`, `percussive_tonal`, `instrumental_vocal`) derived from PANNs class-probability contrasts rather than raw embedding projection — interpretable, no second inference. Confidence shown as numeric percentages in chord/section/motif labels.

Deliverable: all stable features from the catalog. **M5 complete.**

---

## Milestone 6 — Favorites, polish, aspirational

- **Slice 0 — code review.** Before the UI rework and shipping-quality polish, review the full codebase accumulated across M1–M5 (sidecar pipeline, IPC, frontend) for correctness bugs and reuse/simplification/efficiency cleanups. The walking-skeleton path carried intentional debt (duplicated graph interaction code, ad-hoc growth) — fix or document it here so the rework builds on a clean base.
- **UI/UX design doc + dashboard rework.** Write a dedicated UI design doc (visual language, layout, interaction model, component system) now that the full feature set exists, then rework the frontend against it. The UI built through M1–M5 is intentionally minimal and functional — treat it as a replaceable presentation layer, not the final design. See the frontend layering contract in `development.md`. This is the single place all UI design happens; nothing UI is designed piecemeal before here. Scope includes the **dashboard** (stacked graphs on a shared time axis, shared zoom/playhead across all lanes, Y-axis dropdown per feature) and **consolidating the zoom/scrub/playhead interaction code** currently duplicated across the concrete graph components (`ContinuousGraph`, `EventGraph`, `HeatmapGraph`) into one shared time-axis layer.
- Favorites UI + persistence (`favorites` field in profile.json)
- Metadata editing in the library
- Library filters (status, missing metadata)
- Better error / retry UX
- YouTube import — paste a URL, auto-download the audio as FLAC via `yt-dlp` (`yt-dlp -f bestaudio -x --audio-format flac -o "%(title)s (YouTube).%(ext)s" <url>`), then run it through the normal import flow

Deliverable: shipping-quality v1.

---

## Notes

- **Unscoped ideas live in `ideas.md`.** Possibilities not yet committed to a milestone (separation extras, source restoration, etc.) are parked in `docs/ideas.md`; promote one here when it's committed.
- **Skip cancellation until M4.** Don't queue more than one song until then — there's nothing to cancel.
- **No restart logic in M1.** Just don't quit during analysis. Add the "interrupted → failed" startup query in M4 (with the multi-stage worker) when failure scenarios become common.
- **Spectrogram heatmap rendering** may want a custom Canvas2D pass rather than a uPlot plugin. Decide when M2 hits it.
- **Graph library = uPlot** (see Tech Stack in the design doc).
