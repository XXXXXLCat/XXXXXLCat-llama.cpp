use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Text,
    Vision,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub size_bytes: u64,
    pub kind: ModelKind,
    pub family: Option<String>,
    pub quant: Option<String>,
    pub params: Option<String>,
}

/// How confident we are that `mmproj_path` belongs to `model_path`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MatchConfidence {
    /// Strong name correlation (shared stem).
    Exact,
    /// No name correlation, but it is the only projector next to the model.
    Unique,
    /// Several candidates, weak correlation.
    Weak,
    /// Nothing found.
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MmprojMatch {
    pub mmproj_path: Option<String>,
    pub confidence: MatchConfidence,
    /// 0.0 - 1.0 name correlation score.
    pub score: f64,
    pub candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub id: u64,
    pub ts: i64,
    pub stream: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub last_error: Option<String>,
    pub model_path: Option<String>,
    pub mmproj_path: Option<String>,
    pub endpoint: Option<String>,
}

impl Default for ServerStatus {
    fn default() -> Self {
        Self {
            running: false,
            pid: None,
            started_at: None,
            exit_code: None,
            last_error: None,
            model_path: None,
            mmproj_path: None,
            endpoint: None,
        }
    }
}

/// Persisted launch configuration. Every field has a serde default so that
/// adding new parameters never breaks previously saved settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchConfig {
    // ---- paths -----------------------------------------------------------
    pub llama_dir: String,
    pub server_bin: String,
    pub model_root: String,
    pub model_path: String,
    pub mmproj_path: String,
    pub auto_mmproj: bool,

    // ---- server ----------------------------------------------------------
    pub host: String,
    pub port: u16,
    pub parallel: i32,
    pub cont_batching: bool,
    pub timeout: u32,
    pub threads_http: i32,
    pub alias: String,
    pub api_key: String,
    pub metrics: bool,
    pub props: bool,
    pub slots_endpoint: bool,
    pub webui: bool,
    pub embedding: bool,
    pub jinja: bool,

    // ---- model / memory --------------------------------------------------
    pub ctx_size: u32,
    pub n_predict: i32,
    pub batch_size: u32,
    pub ubatch_size: u32,
    pub threads: i32,
    pub threads_batch: i32,
    /// "auto" | "all" | "custom"
    pub gpu_layers_mode: String,
    pub gpu_layers_value: i32,
    pub flash_attn: String,
    pub split_mode: String,
    pub tensor_split: String,
    pub main_gpu: i32,
    pub device: String,
    pub kv_offload: bool,
    pub cache_type_k: String,
    pub cache_type_v: String,
    pub load_mode: String,
    pub numa: String,
    pub lora: String,

    // ---- rope ------------------------------------------------------------
    pub rope_scaling: String,
    pub rope_scale: f64,
    pub yarn_orig_ctx: u32,

    // ---- sampling --------------------------------------------------------
    pub temperature: f64,
    pub top_p: f64,
    pub top_k: i32,
    pub min_p: f64,
    pub repeat_penalty: f64,
    pub repeat_last_n: i32,
    pub presence_penalty: f64,
    pub frequency_penalty: f64,
    pub seed: i64,

    // ---- multimodal ------------------------------------------------------
    pub mmproj_offload: bool,
    pub mmproj_device: String,

    // ---- logging ---------------------------------------------------------
    pub verbosity: i32,
    pub log_timestamps: bool,
    pub log_file: String,

    // ---- misc ------------------------------------------------------------
    pub extra_args: String,
    pub kill_on_exit: bool,
    pub auto_open_browser: bool,
}

impl Default for LaunchConfig {
    fn default() -> Self {
        Self {
            llama_dir: String::from("D:\\llama.cpp\\llama.cpp"),
            server_bin: String::from("llama-server.exe"),
            model_root: String::from("D:\\llama.cpp\\model"),
            model_path: String::new(),
            mmproj_path: String::new(),
            auto_mmproj: true,

            host: String::from("127.0.0.1"),
            port: 8080,
            parallel: -1,
            cont_batching: true,
            timeout: 3600,
            threads_http: -1,
            alias: String::new(),
            api_key: String::new(),
            metrics: false,
            props: false,
            slots_endpoint: true,
            webui: true,
            embedding: false,
            jinja: true,

            ctx_size: 8192,
            n_predict: -1,
            batch_size: 2048,
            ubatch_size: 512,
            threads: -1,
            threads_batch: -1,
            gpu_layers_mode: String::from("auto"),
            gpu_layers_value: 999,
            flash_attn: String::from("auto"),
            split_mode: String::from("layer"),
            tensor_split: String::new(),
            main_gpu: 0,
            device: String::new(),
            kv_offload: true,
            cache_type_k: String::from("f16"),
            cache_type_v: String::from("f16"),
            load_mode: String::from("auto"),
            numa: String::new(),
            lora: String::new(),

            rope_scaling: String::from("none"),
            rope_scale: 1.0,
            yarn_orig_ctx: 0,

            temperature: 0.8,
            top_p: 0.95,
            top_k: 40,
            min_p: 0.05,
            repeat_penalty: 1.0,
            repeat_last_n: 64,
            presence_penalty: 0.0,
            frequency_penalty: 0.0,
            seed: -1,

            mmproj_offload: true,
            mmproj_device: String::new(),

            verbosity: 3,
            log_timestamps: true,
            log_file: String::new(),

            extra_args: String::new(),
            kill_on_exit: true,
            auto_open_browser: false,
        }
    }
}

/// Persisted UI state that is not part of the launch configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub config: LaunchConfig,
    pub last_model_root: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            config: LaunchConfig::default(),
            last_model_root: LaunchConfig::default().model_root,
        }
    }
}
