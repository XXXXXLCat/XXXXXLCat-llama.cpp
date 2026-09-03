use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::models::{match_mmproj, scan_models};
use crate::server::ServerManager;
use crate::settings;
use crate::types::{AppSettings, LaunchConfig, LogLine, MmprojMatch, ModelFile, ServerStatus};

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings_input: AppSettings) -> Result<(), String> {
    settings::save(&app, &settings_input)
}

#[tauri::command]
pub fn scan_model_dir(root: String) -> Result<Vec<ModelFile>, String> {
    scan_models(&root)
}

/// Auto-resolve the vision projector that belongs to `model_path`.
#[tauri::command]
pub fn resolve_mmproj(model_path: String, root: String) -> Result<MmprojMatch, String> {
    let models = scan_models(&root)?;
    Ok(match_mmproj(&model_path, &models))
}

#[tauri::command]
pub fn start_server(
    app: AppHandle,
    manager: State<'_, ServerManager>,
    config: LaunchConfig,
) -> Result<(), String> {
    let mut stored: AppSettings = settings::load(&app);
    stored.config = config.clone();
    settings::save(&app, &stored)?;
    manager.start(&config)
}

#[tauri::command]
pub fn stop_server(manager: State<'_, ServerManager>) -> Result<(), String> {
    manager.stop()
}

#[tauri::command]
pub fn get_status(manager: State<'_, ServerManager>) -> ServerStatus {
    manager.status()
}

#[tauri::command]
pub fn get_logs(manager: State<'_, ServerManager>) -> Vec<LogLine> {
    manager.logs()
}

#[tauri::command]
pub fn clear_logs(manager: State<'_, ServerManager>) {
    manager.clear_logs()
}

/// Build the argument vector without launching — powers the command preview.
#[tauri::command]
pub fn preview_command(config: LaunchConfig) -> Vec<String> {
    let bin = if config.server_bin.trim().is_empty() {
        String::from("llama-server.exe")
    } else {
        config.server_bin.clone()
    };
    let mut args = vec![bin];
    args.extend(crate::server::build_args(&config));
    args
}

/// TCP probe used to tell "port open" apart from "process alive".
#[tauri::command]
pub fn probe_endpoint(host: String, port: u16) -> bool {
    // 监听地址可能是通配的 0.0.0.0 / ::，那不是可连接地址，需先归一化。
    let addr = format!("{}:{}", crate::server::client_host(&host), port);
    match addr.to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(sa) => TcpStream::connect_timeout(&sa, Duration::from_millis(600)).is_ok(),
            None => false,
        },
        Err(_) => false,
    }
}

#[tauri::command]
pub fn pick_directory(app: AppHandle, start: Option<String>) -> Result<Option<String>, String> {
    let (tx, rx) = mpsc::channel();
    let mut dialog = app.dialog().file();
    if let Some(dir) = start.filter(|s| !s.trim().is_empty()) {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_folder(move |folder| {
        let _ = tx.send(folder.and_then(|f| f.into_path().ok()));
    });
    rx.recv()
        .map(|opt| opt.map(|p| p.to_string_lossy().to_string()))
        .map_err(|e| format!("目录选择失败: {e}"))
}

#[tauri::command]
pub fn pick_file(
    app: AppHandle,
    start: Option<String>,
    filters: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let (tx, rx) = mpsc::channel();
    let mut dialog = app.dialog().file();
    if let Some(dir) = start.filter(|s| !s.trim().is_empty()) {
        dialog = dialog.set_directory(dir);
    }
    if let Some(exts) = filters.filter(|f| !f.is_empty()) {
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter("文件", &refs);
    }
    dialog.pick_file(move |file| {
        let _ = tx.send(file.and_then(|f| f.into_path().ok()));
    });
    rx.recv()
        .map(|opt| opt.map(|p| p.to_string_lossy().to_string()))
        .map_err(|e| format!("文件选择失败: {e}"))
}

/// Open a URL (or a local directory) with the shell default handler.
#[tauri::command]
pub fn open_in_shell(target: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &target])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开失败: {e}"))
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开失败: {e}"))
    }
}

/// Reveal a file or folder in the OS file manager.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let target = PathBuf::from(&path);
        let arg = if target.is_dir() {
            target.to_string_lossy().to_string()
        } else {
            format!("/select,{}", target.to_string_lossy())
        };
        std::process::Command::new("explorer")
            .arg(arg)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开资源管理器失败: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台未实现".to_string())
    }
}

/// 采集系统硬件指标：CPU 占用、物理内存、GPU（名称/利用率/显存/温度）。
/// 失败时不抛错，返回尽力可得的数据；无 NVIDIA 显卡时 `gpus` 为空。
#[tauri::command]
pub fn get_system_metrics() -> crate::metrics::SystemMetrics {
    crate::metrics::collect()
}
