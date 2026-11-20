// Desktop shell for the modeler. All modelling happens in the web front end; the shell adds
// native file dialogs and file access (save/open/export, autosave backups), the updater, opening a
// .vorm file double-clicked in Explorer, choosing which graphics card draws the view (Windows
// only for now), and Google Drive sign-in (google.rs). On Linux it runs as an AppImage on WebKitGTK.

mod google;

#[cfg(windows)]
use tauri::Manager;

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

/// Which graphics card draws the view: "high" (the default: the faster, separate card on laptops
/// that have two), "low" (the power-saving built-in one) or "auto" (Windows decides). Kept in a small file
/// in the app's config folder, because the choice is needed before the window (and the web page
/// with its settings) exists. It takes effect the next time the app starts.
///
/// Windows only: the choice is passed to WebView2. WebKitGTK on Linux has no such switch, so there
/// the system decides (choosing there too, through DRI_PRIME, is in TODO.md).
#[cfg(windows)]
const GRAPHICS_FILE: &str = "graphics.txt";

#[cfg(windows)]
fn graphics_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
  app.path().app_config_dir().ok().map(|d| d.join(GRAPHICS_FILE))
}

#[cfg(windows)]
fn read_graphics(app: &tauri::AppHandle) -> String {
  let value = graphics_path(app).and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
  match value.trim() {
    "auto" | "low" => value.trim().to_string(),
    _ => "high".to_string(),
  }
}

/// The saved choice, or None where it cannot be chosen (Linux).
#[tauri::command]
fn graphics_preference(app: tauri::AppHandle) -> Option<String> {
  #[cfg(windows)]
  return Some(read_graphics(&app));
  #[cfg(not(windows))]
  {
    let _ = app;
    None
  }
}

#[tauri::command]
fn set_graphics_preference(app: tauri::AppHandle, value: String) -> Result<(), String> {
  #[cfg(not(windows))]
  {
    let _ = (app, value);
    return Err("The graphics card cannot be chosen on this system".into());
  }
  #[cfg(windows)]
  set_graphics_file(&app, &value)
}

#[cfg(windows)]
fn set_graphics_file(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
  if !matches!(value, "auto" | "high" | "low") {
    return Err(format!("Unknown graphics choice {value}"));
  }
  let path = graphics_path(app).ok_or("No config folder")?;
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  std::fs::write(path, value).map_err(|e| e.to_string())
}

/// WebView2's browser arguments: the defaults Tauri uses, plus the graphics card choice.
#[cfg(windows)]
fn browser_args(graphics: &str) -> String {
  let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
  match graphics {
    "high" => args.push_str(" --force_high_performance_gpu"),
    "low" => args.push_str(" --force_low_power_gpu"),
    _ => {}
  }
  args
}

/// WebKitGTK draws through DMA-BUF, which shows a blank or crashing window with Nvidia's own
/// driver. Turning that path off is the usual fix; it must happen before the first window opens.
#[cfg(target_os = "linux")]
fn webkit_workarounds() {
  let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
  if nvidia && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    // SAFETY: called first thing in run(), before any other thread exists.
    unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "linux")]
  webkit_workarounds();
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      launch_file,
      graphics_preference,
      set_graphics_preference,
      google::google_client,
      google::google_authorize,
      google::google_saved_token,
      google::google_save_token,
      google::google_forget_token
    ])
    .setup(|app| {
      // The main window is made here (not in tauri.conf.json) so the graphics card choice can be
      // passed to WebView2 when it starts.
      let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("VormCraft")
        .inner_size(1400.0, 900.0)
        .min_inner_size(800.0, 500.0)
        .resizable(true)
        .center();
      #[cfg(windows)]
      let window = window.additional_browser_args(&browser_args(&read_graphics(app.handle())));
      window.build()?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running VormCraft");
}
