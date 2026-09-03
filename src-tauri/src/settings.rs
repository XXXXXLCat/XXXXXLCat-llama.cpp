use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::types::AppSettings;

const SETTINGS_FILE: &str = "settings.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录: {e}"))?;
    Ok(dir.join(SETTINGS_FILE))
}

pub fn load(app: &AppHandle) -> AppSettings {
    match settings_path(app) {
        Ok(path) => match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("settings.json 解析失败，回退到默认配置: {e}");
                    AppSettings::default()
                }
            },
            // Absent file is the normal first-run case.
            Err(_) => AppSettings::default(),
        },
        Err(e) => {
            log::warn!("{e}");
            AppSettings::default()
        }
    }
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let content =
        serde_json::to_string_pretty(settings).map_err(|e| format!("配置序列化失败: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("配置写入失败: {e}"))?;
    Ok(())
}
