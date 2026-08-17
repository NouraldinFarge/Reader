#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
fn is_reader_navigation(url: &tauri::Url) -> bool {
    let packaged_origin =
        matches!(url.scheme(), "tauri") || matches!(url.host_str(), Some("tauri.localhost"));
    let development_origin = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port_or_known_default() == Some(4173);

    packaged_origin || development_origin
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // This must remain the first registered plugin. A second launch exits and
    // brings the one existing Reader window back to the foreground.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                let main_config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|config| config.label == "main")
                    .ok_or_else(|| {
                        std::io::Error::other("missing main Reader window configuration")
                    })?;

                // The window is created here (rather than automatically from
                // tauri.conf.json) so the native WebView can reject every
                // popup request before any application JavaScript runs.
                tauri::WebviewWindowBuilder::from_config(app, main_config)?
                    .devtools(false)
                    .on_navigation(is_reader_navigation)
                    .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
                    .build()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Reader");
}
