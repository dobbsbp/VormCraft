// Google Drive sign-in for the desktop app needs VormCraft's "desktop" client at Google. Its
// details are never in the repository: release builds get them from the GOOGLE_DESKTOP_CLIENT_JSON
// secret (the JSON file Google gives you), local builds from ~/.vormcraft/google-desktop-client.json.
// Without either, the app is built without Google Drive.

fn google_client() -> Option<(String, String)> {
  let text = match std::env::var("GOOGLE_DESKTOP_CLIENT_JSON") {
    Ok(t) if !t.trim().is_empty() => t,
    _ => {
      let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
      let path = std::path::Path::new(&home).join(".vormcraft").join("google-desktop-client.json");
      println!("cargo:rerun-if-changed={}", path.display());
      std::fs::read_to_string(path).ok()?
    }
  };
  let json: serde_json::Value = serde_json::from_str(&text).ok()?;
  let client = json.get("installed").unwrap_or(&json);
  let id = client.get("client_id")?.as_str()?.to_string();
  let secret = client.get("client_secret")?.as_str()?.to_string();
  Some((id, secret))
}

fn main() {
  println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_JSON");
  if let Some((id, secret)) = google_client() {
    println!("cargo:rustc-env=VORMCRAFT_GOOGLE_CLIENT_ID={id}");
    println!("cargo:rustc-env=VORMCRAFT_GOOGLE_CLIENT_SECRET={secret}");
  }
  tauri_build::build()
}
