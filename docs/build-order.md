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
- `swing`, `harmonic_complexity`, `reverb_amount`, `roughness` (`[WIP]`; `roughness` needs essentia/AGPL) → **M6** — aspirational/refinement.
- `sections`/`motifs`/`novelty` and PANNs `sound_tags`/`timbral_axes` (ML) → **M5** (already planned).
- `valence`/`tension` (`[WIP]` emotional ML) → **M6** (already planned).

Deliverable: complete mix-level DSP for everything cheap and dependency-light; deeper-dependency, segment-mode, ML, and WIP features reassigned above.

---

## Milestone 3 — Chords + downbeats (PyTorch enters)

First trained model in the pipeline. Both features are mix-level and run inside the existing single-pass DSP-mix stage — no multi-stage worker yet (that lands with Demucs in M4). This milestone exists to introduce and de-risk the torch dependency on a light, fast model before the heavier Demucs stage.

- **`chords` (event), via the BTC transformer** ([jayg996/BTC-ISMIR19](https://github.com/jayg996/BTC-ISMIR19), MIT, 12 MB checkpoint, CPU-fine). Vendor `btc_model.py` + its helpers; features are a librosa CQT (n_bins 144, bins/oct 24, hop 2048, 22050 Hz); large-voca = 170 chord classes → `{t, root, quality, confidence}`. Renders on the existing `EventGraph` tick lane.
- **`downbeats` (event) — librosa-based heuristic.** Derive downbeats from the M2 beat grid: assume 4/4 and pick the bar-start phase by scoring each of the four candidate phases against musical cues (onset strength, low-frequency/kick energy, harmonic change at bar boundaries). No new dependency, runs off data we already compute. Chosen over madmom (py3.12 / M-series build friction — the reason Python is pinned) and a torch downbeat model. Accuracy is weaker on meter changes / pickup bars; see the dev-log note for future upgrade paths if it proves inadequate.
- Add `torch` to the sidecar deps. Do the freeze spike here (torch native libs are the hard part of eventual packaging) — investigate only; keep running from source.
- **Model weights: download-on-first-run into a local cache; never in git.** Build a small `sidecar/models.py` registry — `{name, url, sha256, dest}` per model — and an `ensure(model)` that checks the cache, downloads + checksum-verifies if missing, and fails loudly on mismatch. Cache dir lives in the app-data dir (`~/Library/Application Support/Prism/models/` on macOS), gitignored. The BTC checkpoint (~12 MB) is the only model needing this hand-rolled in M3 (it's vendored code, not a pip package); mirror it to a GitHub Release on our own repo and point the registry there so we control the URL. Demucs (M4) and PANNs (M5) auto-download and cache their own weights — reuse this pattern only for parity (point their cache at the same dir); don't reimplement their fetch.

Deliverable: chords + downbeats rendering against playback; torch in the dependency set and de-risked.

---

## Milestone 4 — Demucs + per-stem DSP

First long-running stage; introduces the multi-stage worker. Sub-progress and failure handling matter here.

- **Multi-stage worker.** Refactor the single-pass worker into ordered stages (`dsp-mix → demucs → dsp-stem`). Surface progress: extend the `library.songs` snapshot with `current_stage` / `current_stage_progress` (keeps the UI a pure function of snapshots, matching the existing model) rather than a parallel `job.*` event stream.
- Demucs stage; stems written to `library/songs/{uuid}/stems/`; progress wired from Demucs's callback.
- Per-stem DSP features (energy, onsets, transients, centroid, MFCC; pitch for melodic stems; vibrato for vocals) — reuse the mix extractors per stem; write under `stems.{stem}.features`.
- Failure handling end-to-end: kill the sidecar mid-Demucs and confirm the "Analysis interrupted" startup logic works; clean up the partial song folder on failure.
- Cancellation of queued songs.
- Dashboard: stem section, grouped per-stem features (reuse existing graph components).

Deliverable: full DSP pipeline including stems.

---

## Milestone 5 — ML classification + structure

- PANNs sound classification (model download + caching, class subset decision) — `sound_tags`, `timbral_axes`
- Section detection (msaf) — `sections`, the first `segment` render mode
- Motif recurrence + novelty — `motifs`, `novelty`
- `silence` (segment) and `rhythmic_density` (continuous) — mix-level DSP deferred from M2; `silence` rides the new `segment` render mode
- Confidence rendering in the dashboard (reduced opacity, error bars, or similar)

Deliverable: all stable features from the catalog.

---

## Milestone 6 — Favorites, polish, aspirational

- **UI/UX design doc + dashboard rework.** Write a dedicated UI design doc (visual language, layout, interaction model, component system) now that the full feature set exists, then rework the frontend against it. The UI built through M1–M5 is intentionally minimal and functional — treat it as a replaceable presentation layer, not the final design. See the frontend layering contract in `development.md`. This is the single place all UI design happens; nothing UI is designed piecemeal before here. Scope includes the **dashboard** (stacked graphs on a shared time axis, shared zoom/playhead across all lanes, Y-axis dropdown per feature) and **consolidating the zoom/scrub/playhead interaction code** currently duplicated across the concrete graph components (`ContinuousGraph`, `EventGraph`, `HeatmapGraph`) into one shared time-axis layer.
- Favorites UI + persistence (`favorites` field in profile.json)
- Metadata editing in the library
- Library filters (status, missing metadata)
- Better error / retry UX
- Aspirational / `[WIP]` features — implement or drop: `valence`, `tension`, `swing`, `harmonic_complexity`, `reverb_amount`, `roughness` (the last needs essentia/AGPL — use a librosa proxy or drop)
- YouTube import — paste a URL, auto-download the audio as FLAC via `yt-dlp` (`yt-dlp -f bestaudio -x --audio-format flac -o "%(title)s (YouTube).%(ext)s" <url>`), then run it through the normal import flow
- Color palettes — select from or create named palettes of colors that go well together; swapping a palette remaps the visualizer config automatically

Deliverable: shipping-quality v1.

---

## Notes

- **Skip cancellation until M4.** Don't queue more than one song until then — there's nothing to cancel.
- **No restart logic in M1.** Just don't quit during analysis. Add the "interrupted → failed" startup query in M4 (with the multi-stage worker) when failure scenarios become common.
- **Spectrogram heatmap rendering** may want a custom Canvas2D pass rather than a uPlot plugin. Decide when M2 hits it.
- **Graph library = uPlot** (see Tech Stack in the design doc).
