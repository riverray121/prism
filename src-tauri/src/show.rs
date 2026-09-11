// Show frame files for companion publishing (docs/companion-api.md). The
// frontend renders each patched light's frames and hands the bytes here raw
// (an ArrayBuffer invoke body), which keeps them out of the sidecar's JSON
// lines; the sidecar then packs `songs/{id}/show/` into the bundle.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};

// Ids and light keys come from the frontend; reject anything that could
// leave the song folder.
fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && value != "."
        && value != ".."
}

fn show_dir(song_id: &str) -> Result<PathBuf, String> {
    if !safe_segment(song_id) {
        return Err(format!("invalid song id: {song_id:?}"));
    }
    Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("no repo root")?
        .join("library")
        .join("songs")
        .join(song_id)
        .join("show"))
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or(format!("missing header {name}"))?
        .to_str()
        .map_err(|e| e.to_string())
}

// Write one light's frame file: headers carry the song id and light key, the
// raw body is the frame-major RGB bytes.
#[tauri::command]
pub fn write_show_frames(request: Request<'_>) -> Result<(), String> {
    let song_id = header(&request, "x-song-id")?;
    let key = header(&request, "x-light-key")?;
    if !safe_segment(key) {
        return Err(format!("invalid light key: {key:?}"));
    }
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw body".into());
    };
    let dir = show_dir(song_id)?.join("frames");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{key}.bin")), bytes).map_err(|e| e.to_string())
}

// Remove a song's show folder so a publish never carries stale frame files.
#[tauri::command]
pub fn clear_show_frames(song_id: String) -> Result<(), String> {
    let dir = show_dir(&song_id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
