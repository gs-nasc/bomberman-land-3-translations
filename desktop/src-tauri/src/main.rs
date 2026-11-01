// Glifo desktop: a window around src/ plus the bundled engine (binaries/glifo-patcher), which the page
// runs through the shell plugin. The only native code is cleaning up after a cancelled build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Cancelling kills the engine before it can remove its unfinished output (`<output>.part`).
#[tauri::command]
fn discard_partial(output: String) {
    let _ = std::fs::remove_file(format!("{output}.part"));
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![discard_partial])
        .run(tauri::generate_context!())
        .expect("error while running Glifo");
}
