use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

// Handle to the running sidecar's stdin, stored in Tauri state.
struct Sidecar {
    stdin: Mutex<ChildStdin>,
}

// Write one JSON-line command to the sidecar's stdin.
#[tauri::command]
fn send_to_sidecar(sidecar: State<Sidecar>, message: String) -> Result<(), String> {
    let mut stdin = sidecar.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{}", message).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

// Spawn the Python sidecar and forward its stdout lines to the frontend as events.
fn spawn_sidecar(app: &AppHandle) -> Child {
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
        .spawn()
        .expect("failed to spawn sidecar");

    let stdout = child.stdout.take().expect("sidecar stdout piped");
    let app = app.clone();
    // Read sidecar stdout line-by-line on a background thread; forward each line to the frontend.
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = app.emit("sidecar-message", line);
                }
                Err(_) => break,
            }
        }
    });

    child
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let mut child = spawn_sidecar(app.handle());
            let stdin = child.stdin.take().expect("sidecar stdin piped");
            app.manage(Sidecar {
                stdin: Mutex::new(stdin),
            });
            // Keep the child handle alive for the app's lifetime.
            app.manage(Mutex::new(child));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_to_sidecar])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
