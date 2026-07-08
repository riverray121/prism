use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_opener::OpenerExt;

mod applog;

// Facts gathered at startup for the frontend's health surface.
struct StartupInfo {
    unclean_exit: bool,
}

// Handle to the running sidecar's stdin, stored in Tauri state.
struct Sidecar {
    stdin: Mutex<ChildStdin>,
}

// Handle to the running sidecar process, stored in Tauri state for lifecycle control.
struct SidecarProcess {
    child: Mutex<Child>,
}

// Report startup health facts to the frontend.
#[tauri::command]
fn startup_report(info: State<StartupInfo>) -> serde_json::Value {
    serde_json::json!({
        "unclean_exit": info.unclean_exit,
    })
}

// Open the log folder in the OS file browser. Shell-side so no webview
// path-scope permission is needed and PRISM_LOG_DIR overrides are honored.
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_path(applog::dir().to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

// Persist a frontend error (window.onerror / unhandledrejection) in app.log.
#[tauri::command]
fn log_frontend_error(message: String) {
    applog::log(&format!("frontend: {message}"));
}

// Write one JSON-line command to the sidecar's stdin.
#[tauri::command]
fn send_to_sidecar(sidecar: State<Sidecar>, message: String) -> Result<(), String> {
    let mut stdin = sidecar.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{}", message).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

// Strip a trailing CRLF/LF from a read buffer.
fn trim_newline(buf: &mut Vec<u8>) {
    while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
        buf.pop();
    }
}

// Spawn the Python sidecar and forward its stdout/stderr to the frontend as events.
// Returns the child handle (with stdin still attached) or the spawn error.
fn spawn_sidecar(app: &AppHandle) -> std::io::Result<Child> {
    // Dev-only: run from source at the repo root (parent of src-tauri).
    // Bundling will replace this with a frozen binary (deferred to M3+).
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf();

    let mut child = Command::new("uv")
        .args(["run", "python", "-m", "sidecar"])
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Forward sidecar stdout line-by-line to the frontend on a background thread.
    // Reads bytes and decodes lossily so one invalid line does not sever the stream;
    // a read error emits sidecar-error, and EOF emits sidecar-exited with the exit code.
    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        trim_newline(&mut buf);
                        let line = String::from_utf8_lossy(&buf).into_owned();
                        let _ = app.emit("sidecar-message", line);
                    }
                    Err(e) => {
                        let _ = app.emit("sidecar-error", e.to_string());
                        break;
                    }
                }
            }
            // Sidecar stdout closed: reap the process and report its exit code.
            let code = app
                .try_state::<SidecarProcess>()
                .and_then(|s| s.child.lock().ok().and_then(|mut c| c.wait().ok()))
                .and_then(|status| status.code());
            applog::log(&format!("sidecar exited with code {code:?}"));
            let _ = app.emit("sidecar-exited", code);
        });
    }

    // Forward sidecar stderr to the parent log and the frontend for diagnostics.
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        trim_newline(&mut buf);
                        let line = String::from_utf8_lossy(&buf).into_owned();
                        applog::log(&format!("[sidecar] {line}"));
                        let _ = app.emit("sidecar-stderr", line);
                    }
                }
            }
        });
    }

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    applog::init();
    let unclean_exit = applog::startup_unclean_check();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            app.manage(StartupInfo { unclean_exit });
            // Spawn the sidecar; on failure surface an error and keep the app running.
            match spawn_sidecar(app.handle()) {
                Ok(mut child) => {
                    if let Some(stdin) = child.stdin.take() {
                        app.manage(Sidecar {
                            stdin: Mutex::new(stdin),
                        });
                    } else {
                        let _ = app.emit("sidecar-error", "sidecar stdin unavailable".to_string());
                    }
                    // Store the child so the stdout thread can reap it and report its exit code.
                    app.manage(SidecarProcess {
                        child: Mutex::new(child),
                    });
                }
                Err(e) => {
                    let message = format!("failed to spawn sidecar: {e}");
                    applog::log(&message);
                    let _ = app.emit("sidecar-error", message);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_to_sidecar,
            startup_report,
            log_frontend_error,
            open_logs
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Orderly shutdown removes the session marker; a crash leaves it
            // for the next launch to report.
            if let RunEvent::Exit = event {
                applog::clean_exit();
            }
        });
}
