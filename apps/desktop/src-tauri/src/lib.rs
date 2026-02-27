mod commands;
mod error;
mod keychain;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Create system tray icon
            tray::create_tray(app.handle())?;

            // Hide panel when it loses focus (click outside)
            // In dev mode, use a delay to avoid HMR/DevTools stealing focus
            if let Some(window) = app.get_webview_window("panel") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let win = w.clone();
                        // Small delay: if focus returns within 200ms (e.g. DevTools, HMR),
                        // don't hide. This prevents the panel flickering in dev mode.
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(200));
                            if !win.is_focused().unwrap_or(true) {
                                let _ = win.hide();
                            }
                        });
                    }
                });
            }

            // Register global hotkey: Cmd+Shift+R
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let shortcut =
                    Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyR);

                let handle = app.handle().clone();
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                let _ = commands::toggle_panel_internal(&handle);
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(shortcut)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::store_token,
            commands::get_token,
            commands::delete_token,
            commands::copy_to_clipboard,
            commands::show_notification,
            commands::toggle_panel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
