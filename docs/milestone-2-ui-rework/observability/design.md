# Crash Detection & Logging — Design

Persistent logs for all three processes, crash detection with next-launch reporting, and in-app surfacing of failures. Motivated by an unattributable app death: the process tree vanished with no artifact to consult — no log files exist outside the dev terminal, and a sidecar/WebView/shell failure cannot currently be told apart after the fact.

## Goals

- Every process writes a persistent, rotated log file; a post-mortem never depends on a terminal buffer.
- Crashes are detected — a dead sidecar at runtime, an unclean app exit on next launch — and surfaced in the UI, not silent.
- Errors visible to the user carry a pointer to the logs.

## Log architecture

One log root: `~/Library/Application Support/Prism/logs/` (the app-data dir; overridable via `PRISM_LOG_DIR` for dev/tests).

| File          | Writer     | Contents                                                                                     |
| ------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `sidecar.log` | Python     | existing stdlib logging, plus uncaught-exception tracebacks                                  |
| `app.log`     | Rust shell | `tracing` events, panics with backtrace, sidecar lifecycle, forwarded frontend errors        |
| `crash.log`   | Python     | `faulthandler` output — native-level faults (torch/librosa segfaults) dump all thread stacks |

- **Python:** add a `RotatingFileHandler` (5 MB × 3) beside the existing stderr handler; `sys.excepthook` + `threading.excepthook` log CRITICAL with traceback before the process dies; `faulthandler.enable()` pointed at `crash.log`.
- **Rust:** `tracing` + `tracing-appender` (rotating); `std::panic::set_hook` writes the panic + backtrace before unwinding. The shell also **captures the sidecar's stderr** and appends it to `app.log` with a `[sidecar]` prefix — today that stream is visible only in a dev terminal and lost entirely in a normal launch.
- **Frontend:** `window.onerror` + `unhandledrejection` handlers in the shell forward to Rust (`log_frontend_error` command) into `app.log`. WebView errors currently vanish.
- Levels: INFO default, `PRISM_LOG=debug` override. One event per line. No audio/feature payloads in logs.
- Dev mode keeps mirroring everything to the terminal; the files are written in both modes.

## Crash detection

- **Sidecar death (runtime).** The Rust shell already owns the child; add a wait-watcher: if the sidecar exits while the app runs, log the exit code + last stderr lines, and emit a `sidecar-died` event. The frontend shows a persistent banner ("Analysis engine stopped — restart the app · Open logs"). Auto-restart with backoff is a later iteration; detection + banner is v1.
- **Unclean app exit (next launch).** A `logs/session.lock` marker (pid + timestamp) is written at startup and removed on clean exit. A stale marker from a non-running pid at launch means the previous session died uncleanly: log it and show a dismissible notice ("Prism didn't shut down cleanly · Open logs"). Complements the existing worker sweep that fails interrupted `analyzing` rows.
- **Analysis failures** stay as they are (status `failed` + `error_message` on the row) — already detected and surfaced.

## Surfacing

- A shell-owned notice area (top-bar banner) for: sidecar death, unclean-exit notice. Existing surfaces stay where they are (playback errors in the transport, import failures in the library panel) but gain an "Open logs" affordance where useful.
- "Open logs folder" opens the log root via the opener plugin.

## Scope

- In: the three log files with rotation, exception/panic/fault hooks, sidecar stderr capture, sidecar-death banner, session.lock unclean-exit notice, open-logs affordance.
- Out: auto-restarting the sidecar, remote/telemetry reporting, log viewers in-app, structured (JSON) logging.

## Open questions

- Whether `session.lock` distinguishes "app killed" from "machine lost power" (it can't; both report as unclean — acceptable).
- Rotation policy for `app.log` given sidecar stderr can be chatty during separation (start 5 MB × 3, tune later).
