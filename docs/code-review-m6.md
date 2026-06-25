# M6 Slice 0 — Code Review

Full review of the M1–M5 codebase (Python sidecar, IPC, Svelte frontend, Rust shell) before the M6 UI overhaul. Run as a multi-agent review (12 reviewers across subsystems + cross-cutting dimensions), every finding adversarially verified against the source. 55 confirmed findings; 10 false-positives and 2 over-stated findings dropped.

Each entry: **location** · what it is · impact · fix. Severity drives ordering. Nothing here has been changed — this is the work list for the M6 fix pass.

## Priority summary

The highest-leverage fixes before the rework:

1. **Wrap `handle(msg)` in `__main__.py`** — one bad command currently kills the whole IPC channel (H-1). Cheap, high blast-radius.
2. **Make the worker loops crash-proof** — `run()` and the terminal `on_change()` can silently kill the analysis thread (H-4, M-3).
3. **Fix the queue-claim race + add `busy_timeout`** — cancel can be silently undone; concurrent writes throw `database is locked` (H-2, H-3).
4. **Per-feature zod parsing** — one unmodeled feature drops the entire profile silently (H-6). This is the most dangerous coupling given M6 will add features.
5. **Consolidate the four graph components** — already the planned M6 work; this review maps exactly what is duplicated and where copies have diverged (H-5 and the FE-GRAPH group).

---

## High

### H-1 · Malformed command crashes the entire stdin dispatch loop

`sidecar/__main__.py:155-160` · error-handling
`main()` guards only `json.loads`; the `handle(msg)` call is bare. Every branch starts with a pydantic `model_validate`, so any schema-violating-but-valid JSON (`{"type":"queue.cancel"}` with no `song_id`, `paths` not a list, `song_ids: null`) raises `ValidationError` that propagates out of the `for raw in sys.stdin` loop and terminates it. Unguarded DB calls in the `queue.add`/`queue.cancel`/`settings.update` branches crash it the same way (e.g. a sqlite `OperationalError`).
**Impact:** one bad command permanently kills the command channel — UI can no longer drive imports/queue/settings; worker keeps running but the app needs a relaunch.
**Fix:** wrap `handle(msg)` in `try/except Exception` (log, continue); ideally catch `ValidationError` specifically and emit a structured error event.

### H-2 · Queued→analyzing claim is not atomic; a cancel can be silently undone

`sidecar/library.py:166-167` (`mark_analyzing`) / `sidecar/worker.py:163-170` (`_claim_next`) · concurrency
`mark_analyzing` runs `UPDATE … SET status='analyzing' WHERE id=?` with **no status guard**. `_claim_next` does `next_queued` (SELECT) then `mark_analyzing` (UPDATE) as two statements. Between them, the main thread can commit `cancel_queued` (queued→unanalyzed); the worker's unguarded UPDATE then resurrects the row to `analyzing`. `cancel_queued`'s docstring asserts the opposite invariant — the code contradicts its own documentation.
**Impact:** a cancel in that window is reverted; the cancelled song runs a full (long, expensive) separation and ends `analyzing` with no `queued_at`, confusing the snapshot.
**Fix:** guard the claim — `UPDATE … WHERE id=? AND status='queued'`, treat `rowcount==0` as a lost claim and re-poll.

### H-3 · No `busy_timeout`; concurrent writes raise `database is locked` immediately

`sidecar/library.py:56-83` (`connect`) · concurrency
WAL is set but `PRAGMA busy_timeout` never is (default 0). Under WAL two writers still serialize; the worker writes frequently (`mark_stage` per step, `mark_analyzing/analyzed/failed`) while the main thread writes on import/queue/cancel/settings. With timeout 0 the second writer fails instantly instead of waiting. The WAL-switch comment even references `busy_timeout` as if configured.
**Impact:** intermittent unhandled `OperationalError` on overlapping writes; combined with H-1 a contended write crashes the whole command loop. Hard to reproduce, surfaces under load.
**Fix:** `con.execute('PRAGMA busy_timeout=5000')` right after connect; correct the comment.

### H-4 · Unhandled exception in the claim/poll loop kills the worker thread permanently

`sidecar/worker.py:338-347` (`run`) · error-handling
`run()`'s loop has no `try/except` around `_claim_next()` or `time.sleep`. `_claim_next` opens a DB connection and reads/writes rows; any exception (lock beyond timeout, disk/IO error) propagates out of `run()`. The worker is a bare daemon thread with no supervision, so it dies silently and all analysis stops for the process lifetime. The only handler is inside `_process`, which the exception never reaches.
**Impact:** a single transient DB/IO error while claiming permanently halts the queue; queued songs sit forever, no recovery short of relaunch.
**Fix:** wrap the loop body in `try/except Exception` (log, short sleep, continue) — treat the loop as the supervision boundary.

### H-5 · Wheel/scrub/playhead/zoom logic copy-pasted verbatim across all four graphs

`ContinuousGraph.svelte:57-265`, `EventGraph.svelte:58-291`, `HeatmapGraph.svelte:55-364`, `SegmentGraph.svelte:73-310` · maintainability
`clamp`, `timeAtEvent`, `resetZoom`, `trackPlayhead`, `attachInteractions` (full pointer + wheel handler incl. gesture-routing/pan/zoom and deltaMode math), and `ZOOM_FACTOR` are byte-for-byte identical in all four. The two playhead `$effect`s and the create/teardown `$effect` (ResizeObserver + destroy) are duplicated too (~100 lines each).
**Impact:** any scrub/zoom/pan/follow fix must land in four places; divergence is already happening (see FE-GRAPH findings below). This is the central debt M6 must consolidate.
**Fix:** one graph shell owning container, uPlot lifecycle, interactions, `trackPlayhead`, and the playhead draw — parameterized by a per-feature draw callback (line / ticks+labels / heatmap blit / bands) and a `maxX()` provider. See L-FE5/L-FE6 for the y-scale and playhead-bbox variations the shell must parameterize.

### H-6 · One bad feature envelope drops the entire profile silently

`src/lib/ipc/index.ts:58-63`, `src/lib/ipc/messages.ts:161` (and 133, 139) · schema-parity
`mix` and stem `features` are `z.record(z.string(), MixFeatureSchema)` (a discriminated union). zod fails the whole record if **any** value fails → fails `ProfileSchema` → `safeParse` fails → `onSidecarEvent` logs `console.warn` and silently drops the event. So one unmodeled render mode, a new sidecar field, or a single feature missing a required field (e.g. `unit`) makes the whole inspection view show nothing, with no user-visible error.
**Impact:** the single most dangerous parity coupling before a UI overhaul that will add features.
**Fix:** parse each feature entry individually and drop only unparseable ones with a warning; or add a permissive fallback variant to the union so unknown render modes degrade gracefully. At minimum surface a load error to the UI.

---

## Medium

### M-1 · `profile.get` only guards `FileNotFoundError`; `KeyError` on a malformed profile crashes the loop

`sidecar/__main__.py:105-120` · error-handling
After `read_profile`, the code does `profile["song"]["source_file"]` with only `FileNotFoundError` caught. A schema-drifted/partial profile raises `KeyError`/`TypeError` → uncaught → kills the dispatch loop (per H-1). `read_profile` does no validation.
**Fix:** broaden the except (or fix H-1 globally) and log+skip like the `FileNotFoundError` path. Schema drift is realistic right before a schema overhaul.

### M-2 · `analyzed_at` never cleared on re-queue/failure; cancel can resurrect a stale `analyzed`

`sidecar/library.py:119-150, 209-219`; `worker.py:329-334` + `storage.py:97-109` · correctness
`cancel_queued` restores `analyzed` iff `analyzed_at IS NOT NULL`, but `mark_failed` and the re-queue path never clear it. Sequence: analyzed → re-queue → **fails** → re-queue → cancel ⇒ restored to `analyzed`. On the failed run `cleanup_partial` deleted `stems/` and per-engine heatmap subdirs, but the surviving `profile.json` still references them — so the UI shows `analyzed` with missing stem audio/heatmaps and no error. (Note: `profile.json` itself is only written on success, so it is the last _good_ one, not corrupt.)
**Fix:** treat `analyzed_at` as authoritative "complete profile exists" — clear it in `mark_failed`/re-queue, or verify profile/sidecar existence before restoring.

### M-3 · Final `on_change()` in `_process` is outside the try/except

`sidecar/worker.py:335` · error-handling
The terminal snapshot emit (reflecting `analyzed`/`failed`) sits at line 335, outside the try block ending at 334. `on_change` queries the DB and emits IPC; if it raises, the exception escapes into `run()` (no handler) and kills the worker — even though the song succeeded. The same callback inside the try (line 290) is protected, making the asymmetry easy to miss.
**Fix:** move it inside try/except (or fix H-4's loop guard).

### M-4 · `profile.json` written non-atomically

`sidecar/storage.py:76-77` · correctness
`write_profile` does `path.write_text(json.dumps(...))` directly onto the live file. A hard kill/full disk mid-write leaves it truncated → `read_profile` raises `JSONDecodeError`. This is the one non-atomic write in the module (`.npy` uses `np.save`, model download uses `tmp.replace`). Blast radius is bounded (DB only flips `analyzed` _after_ a successful write, and a write error is caught → `mark_failed`), but a SIGKILL/power-loss leftover persists until retry.
**Fix:** write to a sibling temp file then `os.replace()`, mirroring `models.ensure`.

### M-5 · `.npy` parser trusts the header shape; no buffer-length validation

`src/lib/npy.ts:43-44` · correctness
`count` comes from the declared shape and is passed straight to `new Float32Array(buffer, off, count)` with no check that `off + count*4 <= byteLength`. A truncated sidecar makes the constructor throw a raw `RangeError` with no `.npy` context — and `HeatmapGraph`'s load `$effect` (`HeatmapGraph.svelte:330-337`) has no try/catch, so it becomes an unhandled rejection. (`TagsGraph.svelte:45` _does_ wrap `parseNpy` — the gap is HeatmapGraph-specific.)
**Fix:** validate `off + count*4 <= byteLength`, reject an empty `()` shape, rethrow a descriptive "truncated .npy" error; wrap HeatmapGraph's load.

### M-6 · Sidecar-event → state mapping lives in the route component, not the durable layer

`src/routes/+page.svelte:14-32` · layering
The full `SidecarEvent` → `$state` dispatch — including the correctness-critical stale-response guard (`event.song_id === inspection.songId`) and the `settings.loaded` gating — is inline in `onMount`. This is the inbound counterpart to the command senders in `lib/ipc`; per the layering contract it must survive the reskin untouched, but as written it will be deleted/rebuilt with the page chrome, inviting regressions (e.g. dropping the stale-profile guard).
**Fix:** extract an `applySidecarEvent(event)` reducer into `lib/state` (or beside `onSidecarEvent`); the component only wires subscription lifecycle.

### M-7 · In-flight mix decode overwrites `activeBuffer` after a stem is selected

`src/lib/components/InspectionView.svelte:200-216, 139-164` · concurrency
On song change the `$effect` resets to `mix` and kicks off `loadBuffer(mix)`, guarded only on `loadToken` (changes on the _next_ song, not on source switch). If the user solos a stem before the mix decode resolves, the pending decode still runs `if (token === loadToken) activeBuffer = buf`, replacing the stem buffer while the stem source plays.
**Impact:** `duration()`/`formatTime`/end-clamp use the mix length against a playing stem — wrong total, early or never auto-stop. Mostly masked when stem and mix durations match.
**Fix:** `if (token === loadToken && activeKey === "mix") activeBuffer = buf;`, or let `playKey` own `activeBuffer`.

### M-8 · Per-song large arrays held alive through the entire separation phase

`sidecar/worker.py:294-308` · resource (merges three findings)
`y` (~21 MB), `y_stereo` (~42 MB), and the `heatmaps` dict (spectrogram matrix ~80–100 MB for a 4-min track) are bound in `_process` and stay referenced through `_separate_and_analyze_stems` — the most memory-hungry phase (Demucs/RoFormer + per-stem WAVs) — even though `heatmaps` is written and dead after line 303 and `y/y_stereo` are unused by the stem stage (which reloads from disk). ~150–200 MB of avoidable resident data on the 18 GiB target. (Per-stem `ys` in `_stem_entry` _is_ released correctly; `spectrum` is an `_analyze` local and is freed on return — not retained as one reviewer claimed.)
**Fix:** `del heatmaps` after the write loop and `del y, y_stereo` after `_analyze`; optional `gc.collect()` before separation.

### M-9 · Model download has no timeout and no resume; a flaky network drains the queue

`sidecar/models.py:53-78` · error-handling
`urllib.request.urlopen` has no timeout (a stalled socket wedges the worker thread indefinitely), and on any failure the `.part` temp is unlinked in `finally`, so a multi-hundred-MB checkpoint restarts from zero every retry. The exception fails the song; since every queued song needs the same model, a transient outage marches the whole queue to `failed` one full-redownload at a time.
**Fix:** add an `urlopen` timeout; pre-flight `ensure()` required models once before claiming the queue (fail fast, not per-song); consider keeping the verified `.part` for resume.

### M-10 · Rust stdout forwarding loop dies permanently on first read error / invalid UTF-8

`src-tauri/src/lib.rs:43-50` · error-handling
`BufReader::lines()` yields `Err` on any IO error and on invalid UTF-8; the loop does `Err(_) => break`, ending the forwarding thread for the app's lifetime. `send_to_sidecar` (separate stdin handle) keeps succeeding, so the UI hangs forever on all current and future requests with no error surfaced.
**Fix:** on `Err`, emit a `sidecar-error` event so the UI can react; if continuing is desired, read with `read_until(b'\n')` + lossy decode so one bad line doesn't sever the stream.

### M-11 · No frontend notification when the sidecar exits (EOF) or crashes

`src-tauri/src/lib.rs:41-51` · error-handling
On sidecar exit, `lines()` returns `None` and the loop ends cleanly with no event emitted; the frontend is never told. An in-flight request hangs indefinitely (reply never arrives); there's no auto-respawn. (A _new_ request would at least surface a broken-pipe error on next send.)
**Fix:** after the loop, emit `sidecar-exited` (optionally with `child.wait()` status); consider respawn-on-crash or a UI dead-backend state. Pairs with the inert managed `Child` handle (L-RS3).

### M-12 · `spawn_sidecar` panics the whole app if `uv` is missing or spawn fails

`src-tauri/src/lib.rs:35-38, 62-63` · error-handling
`.spawn().expect(...)` and the `stdout/stdin.take().expect(...)` calls panic in the setup hook → `run().expect` aborts the process with no window and no message. Dev-only today, but grows with packaging.
**Fix:** return `Result` from `spawn_sidecar`/setup; surface an error dialog/event instead of panicking.

---

## Low

### DSP / extractors

**L-DSP1 · `peak` and `stereo_width` use non-centered framing, misaligned ~half a hop from every other lane**
`amplitude.py:29`, `spatial.py:21` · correctness
Both use `librosa.util.frame(frame_length=hop, hop_length=hop)` (frame _i_ = `[i*hop, i*hop+hop)`), while every other continuous feature is centered (frame _i_ centered at `i*hop`). Offset ≈ hop/2 (~5 ms). Worse, these two are the _shortest_ (`len//hop` vs `1+len//hop`), so they drive `frame_count = min(...)` and truncate one frame off **every** lane on every song — contradicting the "every continuous feature lines up frame-for-frame" contract.
**Fix:** center-pad by `hop//2` before framing so frame _i_ is centered at `i*hop` and the count matches the centered features.

**L-DSP2 · `spectral_flatness` can return >1.0, violating its declared `[0,1]` range**
`frequency.py:49-52` · correctness
On silent frames librosa returns ~1.0000007 (verified); not clamped before serialization. Can break frontend scaling that trusts a hard 1.0 ceiling.
**Fix:** `np.clip(f, 0.0, 1.0)`.

**L-DSP3 · Empty/short-signal guards in `peak`/`frame_rms` are dead code**
`amplitude.py:29-30`, `spatial.py:21-22` · error-handling
`librosa.util.frame` raises `ParameterError` when `len(x) < hop`, _before_ the `if frames.size` guard runs — so the guard never protects the case it appears to. A sub-hop signal raises unhandled rather than returning empty. (Realistically unreachable for real tracks.)
**Fix:** explicit `len(x) >= hop` check returning zeros/empty, or drop the unreachable branch.

**L-DSP4 · Profile serialization uses `json.dumps` without `allow_nan=False`**
`storage.py:77` (+ `tonal.py:21-32`) · correctness
Default `allow_nan=True` emits non-standard `NaN`/`Infinity` tokens. Current NaN-safety is incidental: `_best_key` survives a silent-chroma NaN only because `NaN > best_corr` is always False; `tonal.tuning_deviation` (`tuning*100`) has no clamp at all. Any future non-finite leak silently produces invalid JSON instead of failing loudly.
**Fix:** `json.dumps(..., allow_nan=False)` so leaks fail fast; add an explicit `np.isfinite` guard in `_best_key`.

**L-DSP5 · Empty signal crashes the BTC CQT builder**
`chords.py:114` · error-handling
On empty `y`, `pieces` is empty and `np.concatenate(pieces, axis=1)` raises `ValueError`. No length guard upstream. (Edge case; other extractors likely fail first on a zero-length signal.)
**Fix:** guard for too-short `y` in `compute_chords`, or assert a minimum length in `_analyze`.

**L-DSP6 · `ssm()` yields zero feature columns for ultra-short (<~47 ms) clips**
`structure.py:89-94` (crashes at `:117`) · correctness
For sub-~47 ms clips the grid collapses so `inner = frames[1:-1]` is empty; `librosa.util.sync` returns a 0-column array → `(0,0)` SSM → `_novelty_curve`'s `np.pad(mode='edge')` raises, failing the whole song's analysis. The comment "yields exactly one column per cell" is false here. (Unreachable for real music; the finding's "~0.25 s" threshold was wrong — actually ~47 ms.)
**Fix:** handle `n_cells <= 1` explicitly (single full-song segment, zero novelty) before building the SSM; fix the comment.

### Frontend graphs (FE-GRAPH — feeds the H-5 consolidation)

**L-FE5 · Continuous vs Event/Segment/Heatmap diverge on y-scale anchoring**
`ContinuousGraph.svelte:114` vs `EventGraph.svelte:111`, `SegmentGraph.svelte:126`, `HeatmapGraph.svelte:176` · correctness
Continuous relies on uPlot autoscale (no y range); the other three pin `y:{range:[0,1]}` because their y series is hidden and they draw manually. A naive shared shell that hardcodes either choice breaks the other group.
**Fix:** make y-scale config part of the per-feature descriptor passed to the shell.

**L-FE6 · Playhead draw hook duplicated with inconsistent bbox math**
`ContinuousGraph.svelte:127-142`, `EventGraph.svelte:160-171`, `HeatmapGraph.svelte:213-224`, `SegmentGraph.svelte:179-190` · maintainability
Four copies of the same red-line draw, each expressing the vertical extent differently (`bbox.top+height` vs precomputed `top/bottom` vs `top+h`) — equivalent today, will drift. Event/Segment draw from `top` while content starts below a reserved band (deliberate, but invisible).
**Fix:** shell draws the playhead once after the per-feature callback, single bbox expression.

**L-FE7 · Wheel pan ignores `deltaMode` scaling (mouse-wheel pans 16×/innerHeight× too slowly)**
`ContinuousGraph.svelte:204`, `EventGraph.svelte:231`, `HeatmapGraph.svelte:284`, `SegmentGraph.svelte:250` · correctness
The pan branch uses raw `e.deltaX`; the page-scroll branch just above applies the deltaMode `k` factor. So line/page-mode horizontal wheel panning of a zoomed graph is far too slow; only trackpad pixel-mode feels right. Identical in all four.
**Fix:** apply the same `k` multiplier in the pan branch (or convert deltas to pixels once at the top).

### Layering / frontend

**L-FE1 · Domain logic and fs-path construction in container components**
`InspectionView.svelte:51-72, 313-348, 486, 542, 680`; `TagsGraph.svelte:39-80` · layering (merges two findings)
Violations of the documented "components are dumb" contract (`development.md:142`): `InspectionView` resolves stem/substem paths (`pathForKey`), builds `${songDir}/${feature.sidecar}` inline, runs Web Audio decode/fetch directly, and embeds chord vocabulary/confidence formatting (`CHORD_QUALITY`, `withConfidence`, `chordLabel`). `TagsGraph` fetches+parses the `.npy` and runs threshold/peak-sort/synthetic-`ContinuousFeature` construction (hardcoding `category:'semantic'`, `source:'panns'` that already exist on the originating feature). No live bug, but untestable and re-authored on reskin — the M6 cleanup target.
**Fix:** move path resolution + audio loading into a state/ipc helper returning ready URLs; extract the tags matrix→rows transform into a pure helper reading provenance from the feature; relocate chord/label formatting to a shared presentation-utils module.

**L-FE2 · `sidecarUrl` path join duplicated three times**
`InspectionView.svelte:486, 542, 680` · maintainability
`${inspection.songDir}/${feature.sidecar}` hand-built in three markup sites (each with its own `songDir` truthiness gate) while `pathForKey` already centralizes song-dir joins for audio.
**Fix:** one `sidecarUrl(sidecar)` helper parallel to `pathForKey`.

**L-FE3 · `listen()` registration races with the initial command dispatch**
`src/lib/ipc/index.ts:46-72`, `+page.svelte:13-35` · concurrency
`onSidecarEvent` returns a synchronous unsubscribe wrapping the still-pending `listen()` promise; `onMount` fires `listLibrary()`/`getSettings()` immediately. Any event emitted before the listener attaches is dropped (Tauri doesn't buffer). Low probability — the command round-trip is heavier than listener registration — but no readiness guarantee or re-list fallback.
**Fix:** make `onSidecarEvent` return `Promise<unsubscribe>` and `await` it before the initial requests.

**L-FE4 · `status:"wip"` on segment features (motifs) is silently stripped by zod**
`messages.ts:80-86` vs `structure.py:415-421` · schema-parity
`SegmentFeatureSchema` doesn't model `status`, so zod strips it; `motifs` (the only segment feature that sets it) never shows its `· wip` badge, unlike continuous/tags features.
**Fix:** add `status: z.string().optional()` to `SegmentFeatureSchema` and render the badge in the segment branch.

**L-FE8 · Decoded `AudioBuffer`s cached unboundedly within a song**
`InspectionView.svelte:40, 64-72, 209` · resource
The `buffers` Map is reset per song (no cross-song leak) but holds every decoded source for the open song's lifetime with no cap. Soloing many engines × stems × substems (6-stem + drum-subsep × multiple engines) accumulates large PCM buffers on the 18 GiB machine.
**Fix:** LRU cap or decode-on-demand without retaining non-active buffers, if stem counts grow.

**L-FE9 · Graph time axis vs audio playback length can diverge**
`InspectionView.svelte:74-76, 190-192, 286-291` + graph clamps · correctness
Graphs use `durationSec = (frame_count-1)/frame_rate_hz`; transport uses `activeBuffer.duration` (decoded length). These two extents are independently derived and can differ by a hop plus container padding/silence. (Per-feature data length is _not_ independent — all truncated to `frame_count` — so it's a two-way, not three-way, divergence.) Cosmetic: playhead reaches a graph edge slightly before/after audio ends; total-time label may mismatch.
**Fix:** pick one authoritative duration (the timeline extent) for both transport and axes.

### Rust shell

**L-RS1 · asset-protocol scope grants the webview read access to all of `$HOME`**
`src-tauri/tauri.conf.json:21-24` · security
Scope `$HOME/**` + `csp: null`. The UI only needs the library root + app-data dir. Low risk for a local app today, but over-broad before packaging / any future embedded content.
**Fix:** narrow the scope to the library/profile dirs; set a restrictive CSP before packaging.

**L-RS2 · Sidecar stderr is inherited, not captured**
`src-tauri/src/lib.rs:30-36` · error-handling
Only stdin/stdout are piped. Python tracebacks, torch/librosa warnings, separator progress go to the parent terminal — lost entirely in a packaged build (`windows_subsystem=windows` hides the console). Hurts post-packaging diagnosis.
**Fix:** pipe stderr to a log file and/or a `sidecar-stderr` event.

**L-RS3 · Managed `Child` handle is inert (dead storage)**
`src-tauri/src/lib.rs:67-68` · maintainability
`app.manage(Mutex::new(child))` is never read; std `Child` neither kills nor waits on `Drop`, so it neither keeps the process alive nor enables cleanup. The comment implies lifecycle management that doesn't happen.
**Fix:** becomes meaningful once M-11's exit handler locks it to kill/wait; until then, fix the comment.

### Library / storage / models

**L-LIB1 · `get_setting` raises on malformed/empty stored JSON**
`sidecar/library.py:250-253` · error-handling
`json.loads(row['value'])` unguarded. The only writer always `json.dumps`, so unreachable in normal operation — but external corruption / a future format change would break `get_engines`/`get_drum_subsep` instead of falling back to default.
**Fix:** wrap in `try/except json.JSONDecodeError` → return `default`.

**L-ST1 · `models.ensure` re-hashes the full cached file on every call (PANNs not process-cached)**
`sidecar/models.py:57`; call site `semantic.py:145` · performance
`_sha256(dest)` runs over the whole file every invocation. `panns_features` calls `ensure('panns_cnn14_sed')` once per song with no `_loaded`-style cache (unlike `chords.py`, which _is_ cached), so each analysis SHA-256s the 327 MB checkpoint (~0.5–1.5 s) purely to confirm an unchanged file. (BTC is already process-cached — that part of the finding was wrong.)
**Fix:** per-process verified-path cache, or skip re-hash when the file exists and matches size/mtime, verifying hash only on download.

**L-SEP1 · Canonical stem renaming silently overwrites on name collision**
`sidecar/separation.py:74-82` · correctness
`src.replace(dest)` blindly overwrites; two outputs canonicalizing to the same key drop a stem from disk and the dict with no error. The regex fallback can also yield spaced keys (`(No Vocals)` → `no vocals`) that flow into `stems/{engine}/{stem}.wav` paths and could miss the `stem_name == "drums"` sub-sep branch. Latent — no current engine collides — but the module explicitly invites new engines.
**Fix:** detect collisions (raise/log), normalize whitespace when deriving the key.

**L-WK1 · `dsp-stem`/`drum-subsep` stage flapping + redundant per-stem row writes**
`sidecar/worker.py:243-282` · design
`_set_stage` is called inside the per-stem loop with identical engine/step/total — a DB write + snapshot emit per stem with no new info. With drum sub-sep on, the stage oscillates dsp-stem → drum-subsep → dsp-stem as the loop passes the drums stem, so the UI visibly regresses.
**Fix:** set `dsp-stem` once per engine before the stem loop; re-enter `drum-subsep` only as a distinct transient if it must be shown.

**L-WK2 · Duplicated progress-column reset across three terminal transitions**
`sidecar/library.py:196-244` · maintainability
`mark_analyzed`, `mark_failed`, `fail_interrupted` each repeat the same `current_stage/engine/step/total = NULL` clause; `mark_stage` writes the same set. Adding a progress column risks leaving a stale value if one site is missed. (`current_stage_progress` is already absent from `_ADDED_COLUMNS` and the resets — exactly this drift.)
**Fix:** one shared SQL fragment/helper for the reset.

**L-FAIL1 · `cleanup_partial` leaves orphan mix `.npy` sidecars for permanently-failed songs**
`sidecar/storage.py:97-109`, `worker.py:311-334` · error-handling
On failure, `cleanup_partial` drops `stems/` and per-engine heatmap subdirs but intentionally keeps top-level mix `.npy` files; since `write_profile` only runs on success, a never-retried failed song leaks those sidecars (overwritten on retry). Pure disk leak — no reader enumerates `heatmaps/` (all readers gate on `profile.json`), so the "tool sees failed-song sidecars" half of the finding doesn't apply here.
**Fix:** also remove top-level mix `.npy` in `cleanup_partial`, or document `heatmaps/` is valid only when `profile.json` exists.

---

## Nits

- **N-1 · `library.list`/`settings.get` validate then discard the parsed command** — `__main__.py:90-92, 121-123`. No-op `model_validate` on type-only schemas; dead weight + a crash surface (per H-1). Drop, or adopt one uniform validate-then-dispatch table.
- **N-2 · `ipc.py` docstring claims a global `sys.stdout` redirect that doesn't exist** — `ipc.py:7-11`. The real redirect is a scoped `contextlib.redirect_stdout` in `separation.py:69`; the captured `_OUT` mechanism is still needed. A refactorer could wrongly delete `_OUT` and reintroduce swallowed events. Fix the docstring.
- **N-3 · `_first_tag` non-list branch is dead** — `metadata.py:27-29`. `easy=True` always yields lists; the `str(value)` fallback is unreachable.
- **N-4 · `stem.py` module docstring lists already-implemented features as future work** — `stem.py:10-11`. Onsets/transients/pitch/vibrato are implemented; the function docstring is accurate, the module one is stale.
- **N-5 · Motif strength recomputed after being stored** — `structure.py:344-349`. `np.diag(rec, k=lag)` re-extracted for a value already in the `found` tuple.
- **N-6 · `set(curated_ix)` rebuilt per iteration** — `semantic.py:158-162`. Hoist `curated_set` above the comprehension.
- **N-7 · Heatmap blit source-rect rounding** — `HeatmapGraph.svelte:188-211`. Cell-edge vs point convention mismatch offsets the image up to half a frame from the playhead at deep zoom; cosmetic. A full fix adjusts both source and destination rects, not just `sx`.
- **N-8 · Zoom-center `timeAtEvent` unclamped** — graphs (`ContinuousGraph.svelte:225` et al.). Edge-of-plot pinch can anchor slightly out of range; downstream clamps keep the scale in-bounds, so anchor-only jitter. Clamp `center` to `[0, full]`.

---

## Docs drift (fix or relocate)

- **D-1 · `favorites` documented but unimplemented** — `profile-schema.md:92-96, 265-269`. No code emits or models a top-level `favorites` array. (It's an M6 deliverable — keep in build-order, but remove/flag the schema-doc section as not-yet-implemented.)
- **D-2 · `confidence` parallel array documented but unemitted** — `profile-schema.md:136, 253`. No extractor emits a sibling `confidence` array; `pitch_confidence` is a _separate_ feature. zod doesn't model it.
- **D-3 · `schema_version` major-version gate documented but absent** — `profile-schema.md:245`. Neither the zod loader (`messages.ts:146`, plain `z.string()`) nor `read_profile` checks the major. Add the check at the load boundary, or strike the claim.

---

## Dropped findings

10 findings were false-positives (e.g. claims of corruption the header-derived `.npy` count can't actually produce; a "doc promises corruption safety" claim with no such doc). 2 were over-stated and downgraded out: the `.npy` magic-byte/header-bounds nit (the `line:14` "not a .npy file" guard already catches the described cases) and the "create `$effect` recreates the chart on prop changes" claim (most cited props are read only inside `draw` closures, not tracked as create-effect deps, and the tracked ones are static per feature — no real zoom-reset). Both are low-value but the underlying tidiness points (validate buffer bounds; `untrack()` cosmetic props) are already covered by M-5 and the H-5 consolidation.
