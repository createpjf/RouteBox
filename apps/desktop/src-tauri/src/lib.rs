mod commands;
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
        .plugin(tauri_plugin_updater::Builder::default().build())
        .manage(commands::GatewayProcess(std::sync::Mutex::new(None)))
        .setup(|app| {
            // Hide from macOS Dock — this is a menu-bar-only app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Create system tray icon
            tray::create_tray(app.handle())?;

            // Hide panel when it loses focus (click outside)
            // In dev mode, use a delay to avoid HMR/DevTools stealing focus
            if let Some(window) = app.get_webview_window("panel") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let win = w.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(200));
                            if !win.is_focused().unwrap_or(true) {
                                let _ = win.hide();
                            }
                        });
                    }
                });
            }

            // Hide spotlight when it loses focus
            if let Some(window) = app.get_webview_window("spotlight") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let win = w.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(200));
                            if !win.is_focused().unwrap_or(true) {
                                let _ = win.hide();
                            }
                        });
                    }
                });
            }

            // Register global hotkeys
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let shortcut_panel =
                    Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyR);
                let shortcut_spotlight =
                    Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyX);
                let shortcut_translate =
                    Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyT);
                let shortcut_summarize =
                    Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyS);
                let shortcut_explain =
                    Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyE);

                let handle = app.handle().clone();
                let sc_panel = shortcut_panel.clone();
                let sc_spotlight = shortcut_spotlight.clone();
                let sc_translate = shortcut_translate.clone();
                let sc_summarize = shortcut_summarize.clone();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                if *shortcut == sc_panel {
                                    let _ = commands::toggle_panel_internal(&handle);
                                } else if *shortcut == sc_spotlight {
                                    let _ = commands::toggle_spotlight_internal(&handle);
                                } else if *shortcut == sc_translate {
                                    let _ = commands::clipboard_action_sync(&handle, "translate");
                                } else if *shortcut == sc_summarize {
                                    let _ = commands::clipboard_action_sync(&handle, "summarize");
                                } else {
                                    let _ = commands::clipboard_action_sync(&handle, "explain");
                                }
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(shortcut_panel)?;
                app.global_shortcut().register(shortcut_spotlight)?;
                app.global_shortcut().register(shortcut_translate)?;
                app.global_shortcut().register(shortcut_summarize)?;
                app.global_shortcut().register(shortcut_explain)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::store_token,
            commands::get_token,
            commands::delete_token,
            commands::store_cloud_token,
            commands::get_cloud_token,
            commands::delete_cloud_token,
            commands::copy_to_clipboard,
            commands::show_notification,
            commands::toggle_panel,
            commands::toggle_spotlight,
            commands::open_chat,
            commands::read_clipboard,
            commands::clipboard_action,
            commands::spawn_gateway,
            commands::stop_gateway,
            commands::is_gateway_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Kill gateway process before exiting to prevent orphaned bun processes
                let state = app_handle.state::<commands::GatewayProcess>();
                let mut guard = match state.0.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if let Some(ref mut child) = *guard {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                *guard = None;
            }
        });
}
