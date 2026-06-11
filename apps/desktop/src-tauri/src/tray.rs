use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime,
};
use tauri_plugin_positioner::{Position, WindowExt};

pub fn create_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let status_item =
        MenuItem::with_id(app, "status", "Gateway: …", false, None::<&str>)?;
    let start_item = MenuItem::with_id(app, "start", "Start Gateway", true, None::<&str>)?;
    let stop_item = MenuItem::with_id(app, "stop", "Stop Gateway", true, None::<&str>)?;
    let copy_endpoint_item =
        MenuItem::with_id(app, "copy_endpoint", "Copy Endpoint", true, None::<&str>)?;
    let open_item = MenuItem::with_id(app, "open", "Open Panel", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit RouteBox", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &sep1,
            &start_item,
            &stop_item,
            &copy_endpoint_item,
            &sep2,
            &open_item,
            &sep3,
            &quit_item,
        ],
    )?;

    let builder = TrayIconBuilder::with_id("main")
        .icon_as_template(true)
        .tooltip("RouteBox")
        .menu(&menu)
        .show_menu_on_left_click(false);
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    };
    let _tray = builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("panel") {
                    let _ = window.as_ref().window().move_window(Position::TrayBottomCenter);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            // spawn_gateway requires a port supplied by the frontend, so we emit
            // events for the frontend to drive start/stop with the correct port.
            "start" => {
                let _ = app.emit("tray://start", ());
            }
            "stop" => {
                let _ = app.emit("tray://stop", ());
            }
            "copy_endpoint" => {
                let _ = app.emit("tray://copy-endpoint", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("panel") {
                    // Always show & focus — panel hides itself on blur, so left-click = reopen
                    let _ = window.as_ref().window().move_window(Position::TrayBottomCenter);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update the tray tooltip to reflect the current gateway state.
/// Driven by the frontend via the `update_tray_status` command.
pub fn update_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>, status: &str) {
    let tip = match status {
        "running" => "RouteBox — Running",
        "starting" => "RouteBox — Starting…",
        "checking" => "RouteBox — Checking…",
        "failed" => "RouteBox — Gateway failed",
        _ => "RouteBox — Stopped",
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tip));
    }
}
