use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::types::{AppSettings, CURRENT_SCHEMA_VERSION, LaunchConfig};

const SETTINGS_FILE: &str = "settings.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录: {e}"))?;
    Ok(dir.join(SETTINGS_FILE))
}

/// 旧版（schema_version = 0）的 LaunchConfig 把下列字段硬编码为具体默认值并持久化
/// 进 settings.json，导致启动时会把这些「默认」值作为显式参数下发。迁移时把它们
/// 还原为 `None` / `false`（即「不传参」），让 llama-server 采用自身官方默认，
/// 严格符合「不写数据就不传参」的语义。
///
/// 仅当字段**恰好等于旧版硬编码默认值**时才重置，以保留用户在新版中主动设置的
/// 任何值（例如用户确实把 ctxSize 设为 8192）。
fn migrate_config(config: &mut LaunchConfig) {
    if config.parallel == Some(-1) {
        config.parallel = None;
    }
    if config.timeout == Some(3600) {
        config.timeout = None;
    }
    if config.threads_http == Some(-1) {
        config.threads_http = None;
    }
    if config.ctx_size == Some(8192) {
        config.ctx_size = None;
    }
    if config.batch_size == Some(2048) {
        config.batch_size = None;
    }
    if config.ubatch_size == Some(512) {
        config.ubatch_size = None;
    }
    if config.threads == Some(-1) {
        config.threads = None;
    }
    if config.threads_batch == Some(-1) {
        config.threads_batch = None;
    }
    if config.flash_attn.as_deref() == Some("auto") {
        config.flash_attn = None;
    }
    if config.split_mode.as_deref() == Some("layer") {
        config.split_mode = None;
    }
    if config.main_gpu == Some(0) {
        config.main_gpu = None;
    }
    if config.cache_type_k.as_deref() == Some("f16") {
        config.cache_type_k = None;
    }
    if config.cache_type_v.as_deref() == Some("f16") {
        config.cache_type_v = None;
    }
    if config.load_mode.as_deref() == Some("auto") {
        config.load_mode = None;
    }
    if config.cache_reuse == Some(0) {
        config.cache_reuse = None;
    }
    if config.n_cpu_moe == Some(0) {
        config.n_cpu_moe = None;
    }
    if config.n_cpu_ffn == Some(0) {
        config.n_cpu_ffn = None;
    }
    if config.image_min_tokens == Some(0) {
        config.image_min_tokens = None;
    }
    if config.image_max_tokens == Some(0) {
        config.image_max_tokens = None;
    }
    if config.rope_scale == Some(1.0) {
        config.rope_scale = None;
    }
    if config.yarn_orig_ctx == Some(0) {
        config.yarn_orig_ctx = None;
    }
    if config.yarn_ext_factor == Some(1.0) {
        config.yarn_ext_factor = None;
    }
    if config.yarn_attn_factor == Some(1.0) {
        config.yarn_attn_factor = None;
    }
    if config.yarn_beta_slow == Some(1.0) {
        config.yarn_beta_slow = None;
    }
    if config.yarn_beta_fast == Some(1.0) {
        config.yarn_beta_fast = None;
    }
    if config.verbosity == Some(3) {
        config.verbosity = None;
    }
    // 12 个布尔开关已改为 Option<bool>：旧版 bool 的 true/false 会原样读作
    // Some(true)/Some(false)，build_args 的三态映射能精确还原旧行为，且 None(=不下发)
    // 与各 flag 的服务器默认一致，因此这里无需「清空旧版硬编码默认值」的迁移。
}

pub fn load(app: &AppHandle) -> AppSettings {
    match settings_path(app) {
        Ok(path) => match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
                Ok(mut s) => {
                    if s.schema_version < CURRENT_SCHEMA_VERSION {
                        log::info!(
                            "settings.json 配置结构版本 {} < {}，执行一次性迁移：清除旧版预填的默认启动参数",
                            s.schema_version,
                            CURRENT_SCHEMA_VERSION
                        );
                        migrate_config(&mut s.config);
                        s.schema_version = CURRENT_SCHEMA_VERSION;
                        // 持久化清理后的配置，确保磁盘上的数据被真正删除，
                        // 而非「保留数据却下发时不传」。
                        if let Err(e) = save(app, &s) {
                            log::warn!("迁移后的配置写回失败（下次启动会自动重新迁移）: {e}");
                        }
                    }
                    s
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::LaunchConfig;

    /// 构造一个「旧版硬编码默认值」配置，用于验证迁移后全部被清空。
    fn legacy_config() -> LaunchConfig {
        LaunchConfig {
            parallel: Some(-1),
            timeout: Some(3600),
            threads_http: Some(-1),
            ctx_size: Some(8192),
            batch_size: Some(2048),
            ubatch_size: Some(512),
            threads: Some(-1),
            threads_batch: Some(-1),
            flash_attn: Some("auto".into()),
            split_mode: Some("layer".into()),
            main_gpu: Some(0),
            cache_type_k: Some("f16".into()),
            cache_type_v: Some("f16".into()),
            load_mode: Some("auto".into()),
            cache_reuse: Some(0),
            n_cpu_moe: Some(0),
            n_cpu_ffn: Some(0),
            image_min_tokens: Some(0),
            image_max_tokens: Some(0),
            rope_scale: Some(1.0),
            yarn_orig_ctx: Some(0),
            yarn_ext_factor: Some(1.0),
            yarn_attn_factor: Some(1.0),
            yarn_beta_slow: Some(1.0),
            yarn_beta_fast: Some(1.0),
            verbosity: Some(3),
            log_timestamps: None,
            ..LaunchConfig::default()
        }
    }

    #[test]
    fn migrate_strips_all_legacy_defaults() {
        let mut c = legacy_config();
        migrate_config(&mut c);

        assert_eq!(c.parallel, None);
        assert_eq!(c.timeout, None);
        assert_eq!(c.threads_http, None);
        assert_eq!(c.ctx_size, None);
        assert_eq!(c.batch_size, None);
        assert_eq!(c.ubatch_size, None);
        assert_eq!(c.threads, None);
        assert_eq!(c.threads_batch, None);
        assert_eq!(c.flash_attn, None);
        assert_eq!(c.split_mode, None);
        assert_eq!(c.main_gpu, None);
        assert_eq!(c.cache_type_k, None);
        assert_eq!(c.cache_type_v, None);
        assert_eq!(c.load_mode, None);
        assert_eq!(c.cache_reuse, None);
        assert_eq!(c.n_cpu_moe, None);
        assert_eq!(c.n_cpu_ffn, None);
        assert_eq!(c.image_min_tokens, None);
        assert_eq!(c.image_max_tokens, None);
        assert_eq!(c.rope_scale, None);
        assert_eq!(c.yarn_orig_ctx, None);
        assert_eq!(c.yarn_ext_factor, None);
        assert_eq!(c.yarn_attn_factor, None);
        assert_eq!(c.yarn_beta_slow, None);
        assert_eq!(c.yarn_beta_fast, None);
        assert_eq!(c.verbosity, None);
        assert_eq!(c.log_timestamps, None);
    }

    #[test]
    fn migrate_preserves_genuine_user_values() {
        let mut c = legacy_config();
        // 用户主动设置的真实值（不等于旧版默认，应当被保留）
        c.ctx_size = Some(4096);
        c.threads = Some(8);
        c.flash_attn = Some("false".into());
        migrate_config(&mut c);

        assert_eq!(c.ctx_size, Some(4096));
        assert_eq!(c.threads, Some(8));
        assert_eq!(c.flash_attn, Some("false".into()));
        // 未主动改动的旧版默认仍被清空
        assert_eq!(c.batch_size, None);
        assert_eq!(c.ubatch_size, None);
    }
}
