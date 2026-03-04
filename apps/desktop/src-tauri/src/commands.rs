use crate::keychain;
use tauri::{Emitter, Manager};
use tauri_plugin_positioner::{Position, WindowExt};
use arboard::Clipboard;
use std::sync::Mutex;
use std::process::{Command, Child};

// ── Gateway process state ───────────────────────────────────────────────────

pub struct GatewayProcess(pub Mutex<Option<Child>>);

// ── Keychain commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn store_token(token: String) -> Result<(), String> {
    keychain::store_token(&token)
}

#[tauri::command]
pub async fn get_token() -> Result<Option<String>, String> {
    keychain::get_token()
}

#[tauri::command]
pub async fn delete_token() -> Result<(), String> {
    keychain::delete_token()
}

#[tauri::command]
pub async fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

// ── Panel toggle ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn toggle_panel(app: tauri::AppHandle) -> Result<(), String> {
    toggle_panel_internal(&app)
}

pub fn toggle_panel_internal(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("panel") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            let _ = window
                .as_ref()
                .window()
                .move_window(Position::TrayBottomCenter);
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Spotlight toggle ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn toggle_spotlight(app: tauri::AppHandle) -> Result<(), String> {
    toggle_spotlight_internal(&app)
}

pub fn toggle_spotlight_internal(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("spotlight") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.center().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Chat window ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_chat(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("chat") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Clipboard read ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn read_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

// ── Clipboard action (read + emit event + show spotlight) ───────────────────

#[tauri::command]
pub async fn clipboard_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    clipboard_action_sync(&app, &action)
}

/// Synchronous version for use from shortcut handlers (no async runtime needed)
pub fn clipboard_action_sync(app: &tauri::AppHandle, action: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let text = clipboard.get_text().unwrap_or_default();
    app.emit("spotlight-action", serde_json::json!({ "action": action, "text": text }))
        .map_err(|e: tauri::Error| e.to_string())?;
    toggle_spotlight_internal(app)?;
    Ok(())
}

// ── Gateway process management ──────────────────────────────────────────────

#[tauri::command]
pub async fn spawn_gateway(
    app: tauri::AppHandle,
    port: Option<u16>,
) -> Result<u32, String> {
    eprintln!("[RouteBox] spawn_gateway called, port={:?}", port);
    let state = app.state::<GatewayProcess>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // If already running, return existing PID
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(None) => return Ok(child.id()), // still alive
            _ => { let _ = child.wait(); }     // dead — reap and respawn
        }
    }

    let gateway_port = port.unwrap_or(3001);

    // Get or generate auth token and pass to gateway
    let token = keychain::get_token()
        .ok()
        .flatten()
        .unwrap_or_else(|| {
            let t = generate_token();
            let _ = keychain::store_token(&t);
            t
        });

    let bun_path = which_bun().ok_or_else(|| {
        eprintln!("[RouteBox] bun not found in any known path");
        "bun not found. Install from https://bun.sh or add to PATH".to_string()
    })?;
    eprintln!("[RouteBox] bun found at: {}", bun_path);

    // Resolve gateway entry: prefer bundled resource, fall back to monorepo source
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;

    let bundled = resource_dir.join("gateway-bundle.js");
    let entry = if bundled.exists() {
        // Packaged app: use pre-built single-file bundle
        bundled
    } else {
        // Dev mode: run source from monorepo
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = manifest
            .parent()                 // apps/desktop
            .and_then(|p| p.parent()) // apps
            .and_then(|p| p.parent()) // monorepo root
            .ok_or("Cannot resolve monorepo root")?;

        let dev_entry = root.join("apps/gateway/src/index.ts");
        if !dev_entry.exists() {
            return Err(format!(
                "Gateway not found at {} or {}. Install bun and run from source, or set a remote Gateway URL.",
                bundled.display(),
                dev_entry.display(),
            ));
        }
        dev_entry
    };

    // Resolve real HOME for the child process (sandbox may redirect $HOME)
    let real_home = {
        let mut h = String::new();
        #[cfg(unix)]
        {
            use std::ffi::CStr;
            let pw = unsafe { libc::getpwuid(libc::getuid()) };
            if !pw.is_null() {
                if let Ok(dir) = unsafe { CStr::from_ptr((*pw).pw_dir) }.to_str() {
                    h = dir.to_string();
                }
            }
        }
        if h.is_empty() {
            h = std::env::var("HOME").unwrap_or_default();
        }
        h
    };

    // Build a clean PATH that includes bun's directory and common locations
    let bun_dir = std::path::Path::new(&bun_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let system_path = std::env::var("PATH").unwrap_or_default();
    let child_path = if bun_dir.is_empty() {
        system_path
    } else {
        format!("{bun_dir}:{system_path}")
    };

    // Resolve stable database path in Tauri app data directory
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let db_path = data_dir.join("routebox.db");

    // Migrate old database if it exists at the gateway working dir but not at the new location
    if !db_path.exists() {
        let old_db = entry.parent()
            .unwrap_or(&resource_dir)
            .join("routebox.db");
        if old_db.exists() {
            eprintln!("[RouteBox] migrating old DB from {:?} to {:?}", old_db, db_path);
            let _ = std::fs::copy(&old_db, &db_path);
            let _ = std::fs::copy(old_db.with_extension("db-wal"), db_path.with_extension("db-wal"));
            let _ = std::fs::copy(old_db.with_extension("db-shm"), db_path.with_extension("db-shm"));
        }
    }

    eprintln!("[RouteBox] spawning: {} run {} (cwd={:?}, HOME={:?}, DB={:?})", bun_path, entry.display(), entry.parent(), real_home, db_path);
    let child = Command::new(&bun_path)
        .args(["run", &entry.to_string_lossy()])
        .current_dir(entry.parent().unwrap_or(&resource_dir))
        .env("PORT", gateway_port.to_string())
        .env("ROUTEBOX_TOKEN", &token)
        .env("ROUTEBOX_DB_PATH", db_path.to_string_lossy().to_string())
        .env("HOME", &real_home)
        .env("PATH", &child_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            eprintln!("[RouteBox] spawn failed: {}", e);
            format!("Failed to spawn gateway: {}", e)
        })?;

    let pid = child.id();
    eprintln!("[RouteBox] gateway spawned, pid={}", pid);
    *guard = Some(child);

    // Drop the lock before polling so is_gateway_running can work
    drop(guard);

    // Health-check: poll /health for up to 5 seconds
    let health_url = format!("http://127.0.0.1:{gateway_port}/health");
    let mut healthy = false;
    for attempt in 1..=25 {
        std::thread::sleep(std::time::Duration::from_millis(200));
        eprintln!("[RouteBox] health check attempt {attempt}/25: {health_url}");

        // Check if process died
        {
            let state2 = app.state::<GatewayProcess>();
            let mut g = state2.0.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut c) = *g {
                match c.try_wait() {
                    Ok(Some(status)) => {
                        // Process exited — read stderr for diagnostics
                        let mut stderr_out = String::new();
                        if let Some(ref mut se) = c.stderr {
                            use std::io::Read;
                            let _ = se.read_to_string(&mut stderr_out);
                        }
                        *g = None;
                        let msg = if stderr_out.is_empty() {
                            format!("Gateway process exited with {status} before becoming healthy")
                        } else {
                            format!("Gateway process exited with {status}: {}", stderr_out.chars().take(500).collect::<String>())
                        };
                        eprintln!("[RouteBox] {msg}");
                        return Err(msg);
                    }
                    Ok(None) => {} // still running
                    Err(_) => {}
                }
            }
        }

        // Try HTTP health check
        match std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{gateway_port}").parse().unwrap(),
            std::time::Duration::from_millis(150),
        ) {
            Ok(_) => {
                eprintln!("[RouteBox] gateway port is open on attempt {attempt}");
                healthy = true;
                break;
            }
            Err(_) => continue,
        }
    }

    if !healthy {
        eprintln!("[RouteBox] gateway failed health check after 5s");
        // Kill the process since it didn't become healthy
        let state2 = app.state::<GatewayProcess>();
        let mut g = state2.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut c) = *g {
            let mut stderr_out = String::new();
            if let Some(ref mut se) = c.stderr {
                use std::io::Read;
                let _ = se.read_to_string(&mut stderr_out);
            }
            let _ = c.kill();
            let _ = c.wait();
            *g = None;
            if !stderr_out.is_empty() {
                return Err(format!("Gateway did not start within 5s. stderr: {}", stderr_out.chars().take(500).collect::<String>()));
            }
        }
        return Err("Gateway did not start within 5s — port not open".to_string());
    }

    Ok(pid)
}

#[tauri::command]
pub async fn stop_gateway(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<GatewayProcess>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *guard {
        child.kill().map_err(|e| e.to_string())?;
        let _ = child.wait();
    }
    *guard = None;
    Ok(())
}

/// Check if the spawned gateway process is still running.
/// Side effect: clears dead process state to prevent holding zombie Child handles.
#[tauri::command]
pub async fn is_gateway_running(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<GatewayProcess>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) => { *guard = None; Ok(false) } // exited — clear zombie
            Ok(None) => Ok(true),
            Err(_) => Ok(false),
        }
    } else {
        Ok(false)
    }
}

fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let pid = std::process::id() as u128;
    format!("rb_{:x}{:x}", nanos, pid ^ nanos.wrapping_mul(6364136223846793005))
}

fn which_bun() -> Option<String> {
    // Resolve real HOME — macOS sandboxed apps redirect $HOME to Containers dir
    let home = {
        let mut real_home = String::new();
        #[cfg(unix)]
        {
            use std::ffi::CStr;
            let pw = unsafe { libc::getpwuid(libc::getuid()) };
            if !pw.is_null() {
                if let Ok(dir) = unsafe { CStr::from_ptr((*pw).pw_dir) }.to_str() {
                    real_home = dir.to_string();
                }
            }
        }
        if real_home.is_empty() {
            real_home = std::env::var("HOME").unwrap_or_default();
        }
        real_home
    };

    // Check well-known install locations first (fast, no subprocess)
    let candidates = [
        format!("{home}/.bun/bin/bun"),
        "/usr/local/bin/bun".to_string(),
        "/opt/homebrew/bin/bun".to_string(),
    ];
    eprintln!("[RouteBox] which_bun: HOME={home:?}, checking candidates: {candidates:?}");
    for path in &candidates {
        let exists = std::path::Path::new(path).exists();
        eprintln!("[RouteBox]   {path} exists={exists}");
        if exists {
            return Some(path.clone());
        }
    }

    // Last resort: ask the shell
    if let Ok(output) = Command::new("/bin/sh").args(["-l", "-c", "which bun"]).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let trimmed = path.trim().to_string();
                if !trimmed.is_empty() && std::path::Path::new(&trimmed).exists() {
                    return Some(trimmed);
                }
            }
        }
    }

    None
}
