//! Persistent app-shell log + crash markers.
//!
//! One rotated `app.log` under the shared log root records shell events,
//! panics (with backtrace), captured sidecar stderr, and forwarded frontend
//! errors — so a dead app always leaves an artifact. A `session.lock` marker
//! written at startup and removed on clean exit lets the next launch report
//! an unclean death.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static FILE: Mutex<Option<File>> = Mutex::new(None);

const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Shared log root (same as the sidecar's); `PRISM_LOG_DIR` overrides.
pub fn dir() -> PathBuf {
    if let Ok(d) = std::env::var("PRISM_LOG_DIR") {
        return PathBuf::from(d);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Library/Application Support/Prism/logs")
}

/// Open (rotating if oversized) `app.log` and install the panic hook.
pub fn init() {
    let d = dir();
    let _ = fs::create_dir_all(&d);
    let path = d.join("app.log");
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = fs::rename(&path, d.join("app.log.1"));
        }
    }
    if let Ok(f) = OpenOptions::new().create(true).append(true).open(&path) {
        *FILE.lock().unwrap() = Some(f);
    }
    // A panic must reach the file before unwinding takes the app down.
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log(&format!(
            "PANIC {info}\n{}",
            std::backtrace::Backtrace::force_capture()
        ));
        previous(info);
    }));
    log("app started");
}

/// Append one timestamped line to `app.log`, mirrored to stderr for dev.
pub fn log(line: &str) {
    eprintln!("[app] {line}");
    if let Ok(mut guard) = FILE.lock() {
        if let Some(f) = guard.as_mut() {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let _ = writeln!(f, "{ts} {line}");
        }
    }
}

/// Write this session's lock marker; returns whether the previous session
/// exited uncleanly (its marker was never removed).
pub fn startup_unclean_check() -> bool {
    let lock = dir().join("session.lock");
    let unclean = lock.exists();
    let _ = fs::write(&lock, std::process::id().to_string());
    if unclean {
        log("previous session ended uncleanly (stale session.lock)");
    }
    unclean
}

/// Remove the session marker; called on orderly shutdown only.
pub fn clean_exit() {
    let _ = fs::remove_file(dir().join("session.lock"));
    log("app exiting cleanly");
}
