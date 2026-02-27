use crate::keychain;
use tauri::Manager;
use tauri_plugin_positioner::{Position, WindowExt};
use arboard::Clipboard;

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
