mod commands;
mod metrics;
mod models;
mod server;
mod settings;
mod types;

use server::ServerManager;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.manage(ServerManager::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::scan_model_dir,
            commands::resolve_mmproj,
            commands::start_server,
            commands::stop_server,
            commands::get_status,
            commands::get_logs,
            commands::clear_logs,
            commands::preview_command,
            commands::probe_endpoint,
            commands::pick_directory,
            commands::pick_file,
            commands::open_in_shell,
            commands::reveal_in_explorer,
            commands::get_system_metrics,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let manager = app_handle.state::<ServerManager>();
            let stored = settings::load(app_handle);
            if stored.config.kill_on_exit {
                manager.dispose();
            }
        }
    });
}
