// Desktop shell for the modeler. All modelling happens in the web front end; the shell adds
// native file dialogs and file access (save/open/export, autosave backups), the updater, and
// opening a .vorm file double-clicked in Explorer.

/// A model file the app was started with (double-clicked in Explorer), if any.
#[derive(serde::Serialize)]
struct LaunchFile {
  name: String,
  path: String,
  text: String,
}

/// The .vorm (or older .benup) file passed on the command line, read here so it opens even before
/// the file system plugin has been given access to its folder.
#[tauri::command]
fn launch_file() -> Option<LaunchFile> {
  let path = std::env::args().skip(1).find(|a| {
    let a = a.to_lowercase();
    a.ends_with(".vorm") || a.ends_with(".benup")
  })?;
  let text = std::fs::read_to_string(&path).ok()?;
  let name = std::path::Path::new(&path).file_name()?.to_string_lossy().into_owned();
  Some(LaunchFile { name, path, text })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![launch_file])
    .run(tauri::generate_context!())
    .expect("error while running VormCraft");
}
