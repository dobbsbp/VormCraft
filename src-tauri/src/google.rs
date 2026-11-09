// Google Drive sign-in for the desktop app, the way Google asks desktop apps to do it: the sign-in
// page opens in the person's own browser, and Google sends the answer back to a one-off address
// on this computer (http://127.0.0.1:<port>) that the app listens on for that sign-in only. The
// web front end does the rest (the PKCE codes, swapping the answer for tokens, the Drive calls).
// The long-lived sign-in (refresh token) is kept in Windows Credential Manager, never in a file.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// VormCraft's desktop client at Google, built in from the build machine (see build.rs).
#[derive(serde::Serialize)]
pub struct GoogleClient {
  id: &'static str,
  secret: &'static str,
}

#[tauri::command]
pub fn google_client() -> Option<GoogleClient> {
  match (option_env!("VORMCRAFT_GOOGLE_CLIENT_ID"), option_env!("VORMCRAFT_GOOGLE_CLIENT_SECRET")) {
    (Some(id), Some(secret)) => Some(GoogleClient { id, secret }),
    _ => None,
  }
}

/// Google's answer to a sign-in: where it was sent, and what it said (the query string).
#[derive(serde::Serialize)]
pub struct GoogleReply {
  redirect_uri: String,
  query: String,
}

/// Each sign-in gets a number; starting another one ends the wait of the one before.
static SIGN_IN: AtomicU64 = AtomicU64::new(0);
const WAIT: Duration = Duration::from_secs(300);

/// Open Google's sign-in page (`url`, everything but the redirect address) in the browser and
/// wait for the answer.
#[tauri::command]
pub async fn google_authorize(app: tauri::AppHandle, url: String) -> Result<GoogleReply, String> {
  if !url.starts_with("https://accounts.google.com/") {
    return Err("Not a Google sign-in address".into());
  }
  let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  let redirect_uri = format!("http://127.0.0.1:{port}");
  let full = format!("{url}&redirect_uri={}", redirect_uri.replace(':', "%3A").replace('/', "%2F"));
  let id = SIGN_IN.fetch_add(1, Ordering::SeqCst) + 1;
  app.opener().open_url(full, None::<&str>).map_err(|e| format!("The browser could not be opened: {e}"))?;
  let query = tauri::async_runtime::spawn_blocking(move || wait_for_reply(listener, id)).await.map_err(|e| e.to_string())??;
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
  Ok(GoogleReply { redirect_uri, query })
}

fn wait_for_reply(listener: TcpListener, id: u64) -> Result<String, String> {
  listener.set_nonblocking(true).map_err(|e| e.to_string())?;
  let deadline = Instant::now() + WAIT;
  loop {
    if SIGN_IN.load(Ordering::SeqCst) != id {
      return Err("Google sign-in was cancelled.".into());
    }
    if Instant::now() > deadline {
      return Err("Google sign-in took too long. Try again.".into());
    }
    match listener.accept() {
      Ok((mut stream, _)) => {
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("").to_string();
        let has = |key: &str| query.split('&').any(|p| p.starts_with(&format!("{key}=")));
        if !has("code") && !has("error") {
          // Something else asking (the browser's icon request, say).
          let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          continue;
        }
        let page = reply_page(has("code"));
        let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes());
        return Ok(query);
      }
      Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
      Err(e) => return Err(e.to_string()),
    }
  }
}

fn reply_page(ok: bool) -> String {
  let (title, text) = if ok {
    ("Signed in", "VormCraft can now use your Google Drive. You can close this tab and go back to VormCraft.")
  } else {
    ("Not signed in", "Google Drive was not connected. You can close this tab and try again in VormCraft.")
  };
  format!(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>VormCraft: {title}</title></head>\
     <body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222\">\
     <h1 style=\"font-size:1.4rem\">{title}</h1><p>{text}</p></body></html>"
  )
}

fn token_entry() -> Result<keyring::Entry, String> {
  keyring::Entry::new("VormCraft", "google-drive").map_err(|e| e.to_string())
}

/// The kept sign-in, if there is one.
#[tauri::command]
pub fn google_saved_token() -> Result<Option<String>, String> {
  match token_entry()?.get_password() {
    Ok(t) => Ok(Some(t)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub fn google_save_token(token: String) -> Result<(), String> {
  token_entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn google_forget_token() -> Result<(), String> {
  match token_entry()?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}
