// Desktop shell for the modeler. All modelling happens in the web front end; the shell only adds
// native file dialogs and file access (save/open/export).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .run(tauri::generate_context!())
    .expect("error while running VormCraft");
}
