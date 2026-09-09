use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// 当前配置结构版本。每当「默认配置语义」发生不兼容变更（例如把原先硬编码进
/// settings.json 的启动默认值改为「不传参即采用 llama-server 官方默认」）时递增，
/// 触发一次性迁移：把旧版本里被预填的具体默认值真正删除（置为 `None` / `false`），
/// 而不是保留数据却在下发时跳过——后者与「不写数据就不传参」的语义相悖。
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Text,
    Vision,
    Draft,
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

/// Metadata extracted from a GGUF header (see `gguf::parse_gguf`).
/// Every field is optional because not all models expose every key, and the
/// launcher must degrade gracefully to the filename-derived hints.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
/// Real metadata read from a GGUF file (no weight loading). `extra` carries
/// every scalar / small KV pair verbatim so the UI can show the *complete*
/// metadata map even when llama.cpp adds new keys — the giant tokenizer
/// arrays (tokens / merges / scores / token_type) are excluded to keep the
/// IPC payload small.
pub struct ModelMeta {
    // ---- general ----
    pub architecture: Option<String>,
    pub name: Option<String>,
    pub author: Option<String>,
    pub basename: Option<String>,
    pub finetune: Option<String>,
    pub description: Option<String>,
    pub license: Option<String>,
    pub tags: Option<Vec<String>>,
    pub languages: Option<Vec<String>>,
    pub domain: Option<String>,
    /// GGUF container format version (2 or 3), from the file header.
    pub format_version: Option<u32>,
    /// general.file_version (model file schema version).
    pub file_version: Option<u32>,
    pub quantization_version: Option<u32>,
    /// general.tensor_data_layout, e.g. "q8_0" — a hint for the KV cache dtype.
    pub tensor_data_layout: Option<String>,
    pub param_count: Option<u64>,
    pub context_length: Option<u32>,
    pub size_label: Option<String>,
    pub quant: Option<String>,
    pub file_type: Option<u32>,
    pub vocab_size: Option<u32>,
    pub embedding_length: Option<u32>,
    pub block_count: Option<u32>,
    pub chat_template: Option<String>,
    // ---- architecture block ({arch}.*) ----
    pub head_count: Option<u32>,
    pub head_count_kv: Option<u32>,
    pub key_length: Option<u32>,
    pub value_length: Option<u32>,
    pub norm_epsilon: Option<f32>,
    pub causal: Option<bool>,
    /// Real RoPE theta — standard key is `{arch}.rope.freq_base` (NOT `rope_theta`).
    pub rope_freq_base: Option<f64>,
    pub rope_dim: Option<u32>,
    pub rope_scale_linear: Option<f64>,
    pub rope_scaling_type: Option<String>,
    pub sliding_window: Option<u32>,
    /// pooling_type for embedding models ("mean" / "cls" / "last").
    pub pooling_type: Option<String>,
    pub expert_count: Option<u32>,
    pub expert_used_count: Option<u32>,
    pub bos_token_id: Option<u32>,
    pub eos_token_id: Option<u32>,
    // ---- tokenizer ----
    pub tokenizer_model: Option<String>,
    pub tokenizer_pre: Option<String>,
    pub add_bos: Option<bool>,
    pub add_eos: Option<bool>,
    // ---- verbatim remainder ----
    pub extra: HashMap<String, String>,
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
pub struct DraftMatch {
    pub draft_path: Option<String>,
    pub confidence: MatchConfidence,
    /// 0.0 - 1.0 name correlation score.
    pub score: f64,
    pub candidates: Vec<String>,
}

/// A saved launch profile: a named snapshot of the key model-loading settings
/// so the user can re-launch a known-good configuration with one click.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelProfile {
    pub name: String,
    pub model_path: String,
    pub mmproj_path: String,
    pub draft_model_path: String,
    /// None = 快照不覆盖上下文（沿用 llama-server 默认）
    pub ctx_size: Option<u32>,
    pub gpu_layers_mode: String,
    pub gpu_layers_value: i32,
    /// None = 快照不覆盖 Flash Attention
    pub flash_attn: Option<String>,
}

impl Default for ModelProfile {
    fn default() -> Self {
        Self {
            name: String::new(),
            model_path: String::new(),
            mmproj_path: String::new(),
            draft_model_path: String::new(),
            ctx_size: None,
            gpu_layers_mode: String::from(""),
            gpu_layers_value: 999,
            flash_attn: None,
        }
    }
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
///
/// 所有 `Option<T>` 字段都标注了 `skip_serializing_if = "Option::is_none"`：
/// 当字段为 `None`（即「未设置 / 不传参」）时，序列化时整个 key 都被省略，
/// 磁盘上的 settings.json 不会残留任何「值为 null」的脏数据。
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

    // ---- speculative decoding (MTP / draft) -----------------------------
    pub draft_model_path: String,
    pub auto_draft: bool,

    // ---- server ----------------------------------------------------------
    //
    // `None` 一律表示「未设置」：启动时不下发该参数，由 llama-server 使用自身
    // 默认值。注释里标注的即 llama-server 的默认行为（`llama-server --help`）。
    pub host: String,
    pub port: u16,
    /// 服务槽位数；None = 不下发（默认 -1 = auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel: Option<i32>,
    /// 连续批处理；None=不下发(=默认:开), Some(true)=保持开启(无正flag,不下发), Some(false)=下发 `-nocb`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cont_batching: Option<bool>,
    /// 读写超时（秒）；None = 不下发（默认 3600）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u32>,
    /// HTTP 线程数；None = 不下发（默认 -1）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threads_http: Option<i32>,
    pub alias: String,
    pub api_key: String,
    /// 指标端点；None=不下发(=默认:关), Some(true)=下发 --metrics, Some(false)=无负flag,不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<bool>,
    /// 模型属性端点；None=不下发(=默认:关), Some(true)=下发 --props, Some(false)=无负flag,不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub props: Option<bool>,
    /// 槽位监控端点；None=不下发(=默认:开), Some(true)=保持开启(无正flag,不下发), Some(false)=下发 `--no-slots`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slots_endpoint: Option<bool>,
    /// Web UI；None=不下发(=默认:开), Some(true)=保持开启(无正flag,不下发), Some(false)=下发 `--no-webui`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webui: Option<bool>,
    /// 嵌入端点；None=不下发(=默认:关), Some(true)=下发 --embedding, Some(false)=无负flag,不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<bool>,
    /// Jinja 模板；None=不下发(=默认:开), Some(true)=保持开启(无正flag,不下发), Some(false)=下发 `--no-jinja`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jinja: Option<bool>,

    // ---- model / memory --------------------------------------------------
    /// 上下文长度；None = 不下发（默认 0 = 取模型训练上下文）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ctx_size: Option<u32>,
    /// 逻辑批处理；None = 不下发（默认 2048）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_size: Option<u32>,
    /// 物理批处理；None = 不下发（默认 512）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ubatch_size: Option<u32>,
    /// 生成线程数；None = 不下发（默认 -1）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threads: Option<i32>,
    /// 批处理线程数；None = 不下发（默认同 --threads）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threads_batch: Option<i32>,
    /// "auto" | "all" | "custom" —— 卸载为核心能力，始终下发
    pub gpu_layers_mode: String,
    pub gpu_layers_value: i32,
    /// Flash Attention；None = 不下发（默认 auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flash_attn: Option<String>,
    /// 多卡切分模式；None = 不下发（默认 layer）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_mode: Option<String>,
    pub tensor_split: String,
    /// 主 GPU；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_gpu: Option<i32>,
    pub device: String,
    /// KV 卸载；None=不下发(=默认:开), Some(true)=下发 --kv-offload, Some(false)=下发 -nkvo
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv_offload: Option<bool>,
    /// KV 缓存 K 类型；None = 不下发（默认 f16）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_type_k: Option<String>,
    /// KV 缓存 V 类型；None = 不下发（默认 f16）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_type_v: Option<String>,
    /// 加载模式；None = 不下发（默认 auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub load_mode: Option<String>,
    pub numa: String,
    pub lora: String,

    // ---- model loading extras -------------------------------------------
    /// 提示缓存；None=不下发(=默认:开), Some(true)=保持开启(无正flag,不下发), Some(false)=下发 `--no-cache-prompt`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_prompt: Option<bool>,
    /// 缓存复用最小块；None = 不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_reuse: Option<i32>,
    /// CPU MoE；None=不下发(=默认:关), Some(true)=下发 --cpu-moe, Some(false)=无负flag,不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_moe: Option<bool>,
    /// MoE 权重放 CPU 的层数；None = 不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_cpu_moe: Option<i32>,
    /// FFN 权重放 CPU 的层数；None = 不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_cpu_ffn: Option<i32>,
    /// 图像最小 token；None = 不下发（默认读模型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_min_tokens: Option<u32>,
    /// 图像最大 token；None = 不下发（默认读模型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_max_tokens: Option<u32>,

    // ---- rope ------------------------------------------------------------
    /// "none" 表示不下发（默认 linear，或取模型指定值）
    pub rope_scaling: String,
    /// RoPE 缩放因子；None = 不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rope_scale: Option<f64>,
    /// YaRN 原始上下文；None = 不下发（默认 0 = 模型训练上下文）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yarn_orig_ctx: Option<u32>,

    // ---- rope extras -----------------------------------------------------
    /// None = 不下发（llama-server 默认 -1.00）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yarn_ext_factor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yarn_attn_factor: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yarn_beta_slow: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yarn_beta_fast: Option<f64>,

    // ---- multimodal ------------------------------------------------------
    /// 视觉投影卸载；None=不下发(=默认:开), Some(true)=保持开启(无正flag,不下发), Some(false)=下发 `--no-mmproj-offload`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mmproj_offload: Option<bool>,
    pub mmproj_device: String,

    // ---- logging ---------------------------------------------------------
    /// 日志Verbosity；None = 不下发（默认 3）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verbosity: Option<i32>,
    /// 日志时间戳；None=不下发(=默认:关), Some(true)=下发 --log-timestamps, Some(false)=无负flag,不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_timestamps: Option<bool>,
    pub log_file: String,
    /// 日志着色；空串=默认(不下发 --log-colors，交由 llama.cpp 按 default:auto 处理)；on/off/auto 显式下发
    pub log_colors: String,
    /// 日志前缀；None=不下发(=默认:开), Some(true)=无正flag, Some(false)=下发 `--no-log-prefix`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_prefix: Option<bool>,

    // ---- memory & capacity fitting --------------------------------------
    /// 自动适配显存；None=不下发(=默认:on), Some("on")=下发 --fit on, Some("off")=下发 --fit off
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit: Option<String>,
    /// --fit 的每设备预留 MiB，逗号分隔；空 = 不下发
    pub fit_target: String,
    /// --fit 可调到的最小 ctx；None = 不下发（默认 4096）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_ctx: Option<u32>,
    /// 提示缓存最大 MiB（-1 无限 / 0 禁用）；None = 不下发（默认 8192）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_ram: Option<i32>,
    /// 统一 KV 缓冲；None=不下发, Some(true)=下发 -kvu, Some(false)=下发 -no-kvu
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv_unified: Option<bool>,
    /// 每槽位上下文上限；None = 不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv_unified_per_slot: Option<u32>,
    /// 空闲槽位存入提示缓存；None=不下发(=默认:开), Some(false)=下发 --no-cache-idle-slots
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_idle_slots: Option<bool>,
    /// 全尺寸 SWA 缓存；None=不下发(=默认:关), Some(true)=下发 --swa-full
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swa_full: Option<bool>,
    /// 保留的初始 prompt token 数；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep: Option<i32>,
    /// 无限生成时的上下文移位；None=不下发(=默认:关), Some(true)=下发 --context-shift
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_shift: Option<bool>,
    /// 每槽位最大上下文检查点数；None = 不下发（默认 32）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ctx_checkpoints: Option<u32>,
    /// 检查点最小 token 间距；None = 不下发（默认 8192）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_min_step: Option<u32>,

    // ---- sampling (server-side defaults) --------------------------------
    /// 最大预测 token 数；None = 不下发（默认 -1 = 不限）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predict: Option<i32>,
    pub samplers: String,
    pub sampler_seq: String,
    /// 随机种子；None = 不下发（默认 -1 = 随机）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i32>,
    /// 忽略 EOS；None=不下发(=默认:关), Some(true)=下发 --ignore-eos
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_eos: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_nsigma: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xtc_probability: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xtc_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typical_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_last_n: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_multiplier: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_base: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_allowed_length: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_penalty_last_n: Option<i32>,
    pub dry_sequence_breaker: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adaptive_target: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adaptive_decay: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dynatemp_range: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dynatemp_exp: Option<f64>,
    /// Mirostat 版本；None = 不下发（0=关, 1=Mirostat, 2=Mirostat 2.0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirostat: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirostat_lr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirostat_ent: Option<f64>,
    pub logit_bias: String,
    pub grammar: String,
    pub grammar_file: String,
    pub json_schema: String,
    pub json_schema_file: String,
    /// 后端采样（实验性）；None=不下发(=默认:关), Some(true)=下发 -bs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_sampling: Option<bool>,

    // ---- model loading & tensor control ---------------------------------
    /// 张量缓冲类型覆写；空 = 不下发
    pub override_tensor: String,
    /// 权重复打包；None=不下发(=默认:开), Some(false)=下发 -nr
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repack: Option<bool>,
    /// 绕过 host buffer；None=不下发(=默认:关), Some(true)=下发 --no-host
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_host: Option<bool>,
    /// 按需读取模式 auto/on/off；None = 不下发（默认 auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lazy_mode: Option<String>,
    /// DirectIO；None=不下发, Some(true)=下发 -dio, Some(false)=下发 -ndio
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_io: Option<bool>,
    /// 锁定内存；None=不下发(=默认:关), Some(true)=下发 --mlock
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mlock: Option<bool>,
    /// 内存映射；None=不下发(=默认:开), Some(false)=下发 --no-mmap
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mmap: Option<bool>,
    /// 校验张量数据；None=不下发(=默认:关), Some(true)=下发 --check-tensors
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_tensors: Option<bool>,
    /// 覆写模型元数据 KEY=TYPE:VALUE；空 = 不下发
    pub override_kv: String,
    /// 主机张量运算卸载到设备；None=不下发(=默认:开), Some(false)=下发 --no-op-offload
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_offload: Option<bool>,
    /// RPC 服务器列表 host:port；空 = 不下发
    pub rpc: String,
    pub cpu_mask: String,
    pub cpu_range: String,
    /// 严格 CPU 放置 0/1；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_strict: Option<i32>,
    /// 进程优先级 -1..3；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prio: Option<i32>,
    /// 轮询级别 0..100；None = 不下发（默认 50）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll: Option<i32>,

    // ---- speculative decoding -------------------------------------------
    /// 投机解码类型，逗号分隔；空 = 不下发
    pub spec_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_n_max: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_n_min: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_p_split: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_p_min: Option<f64>,
    /// draft 模型 GPU 层数（可填 auto/all/数字）；空 = 不下发
    pub spec_draft_ngl: String,
    pub spec_draft_device: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_cpu_moe: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_n_cpu_moe: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_threads: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_mod_n_min: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_mod_n_max: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_mod_n_match: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_simple_size_n: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_simple_size_m: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_simple_min_hits: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_map_k_size_n: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_map_k_size_m: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_map_k_min_hits: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_map_k4v_size_n: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_map_k4v_size_m: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_ngram_map_k4v_min_hits: Option<i32>,

    // ---- networking, security & endpoints -------------------------------
    /// 端口复用；None=不下发(=默认:关), Some(true)=下发 --reuse-port
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reuse_port: Option<bool>,
    pub api_prefix: String,
    pub static_path: String,
    pub cors_origins: String,
    pub cors_methods: String,
    pub cors_headers: String,
    /// CORS 凭据；None=不下发(=默认:开), Some(false)=下发 --no-cors-credentials
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cors_credentials: Option<bool>,
    pub ssl_key_file: String,
    pub ssl_cert_file: String,
    pub api_key_file: String,
    /// SSE ping 间隔秒（-1 = 禁用）；None = 不下发（默认 30）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sse_ping_interval: Option<i32>,
    pub media_path: String,
    pub slot_save_path: String,
    pub models_dir: String,
    pub models_preset: String,
    /// 路由服务器最大同时加载模型数；None = 不下发（默认 4）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models_max: Option<i32>,
    /// 路由服务器自动加载；None=不下发(=默认:开), Some(false)=下发 --no-models-autoload
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models_autoload: Option<bool>,
    /// 重排序端点；None=不下发(=默认:关), Some(true)=下发 --reranking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerank: Option<bool>,
    /// 空闲多少秒后休眠；None = 不下发（默认 -1 = 禁用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sleep_idle_seconds: Option<i32>,
    pub log_prompts_dir: String,

    // ---- inference behaviour & templates --------------------------------
    pub chat_template: String,
    pub chat_template_file: String,
    pub chat_template_kwargs: String,
    /// 推理格式 none/deepseek/deepseek-legacy；空 = 不下发
    pub reasoning_format: String,
    /// -rea on|off|auto；None = 不下发（默认 auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub reasoning_effort: String,
    /// 思考 token 预算；None = 不下发（默认 -1）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_budget: Option<i32>,
    /// 保留完整推理轨迹；None=不下发(=默认:开), Some(false)=下发 --no-reasoning-preserve
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_preserve: Option<bool>,
    /// 强制纯内容解析；None=不下发(=默认:关), Some(true)=下发 --skip-chat-parsing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_chat_parsing: Option<bool>,
    /// 预填充助手回复；None=不下发(=默认:开), Some(false)=下发 --no-prefill-assistant
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefill_assistant: Option<bool>,
    /// 池化类型 none/mean/cls/last/rank；空 = 不下发
    pub pooling: String,
    /// 嵌入归一化；None = 不下发（默认 2）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embd_normalize: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_prompt_similarity: Option<f64>,
    /// 预热；None=不下发(=默认:开), Some(false)=下发 --no-warmup
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warmup: Option<bool>,
    pub lookup_cache_static: String,
    pub lookup_cache_dynamic: String,
    pub lora_scaled: String,
    /// 加载 LoRA 但不应用；None=不下发(=默认:关), Some(true)=下发 --lora-init-without-apply
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lora_init_without_apply: Option<bool>,
    pub control_vector: String,
    pub control_vector_scaled: String,
    pub control_vector_layer_range: String,
    /// SPM infill 模式；None=不下发(=默认:关), Some(true)=下发 --spm-infill
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spm_infill: Option<bool>,
    /// 输出特殊 token；None=不下发(=默认:关), Some(true)=下发 -sp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub special: Option<bool>,
    /// 离线模式；None=不下发(=默认:关), Some(true)=下发 --offline
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline: Option<bool>,

    // ---- multimodal & video ---------------------------------------------
    /// 自动使用 mmproj；None=不下发(=默认:开), Some(false)=下发 --no-mmproj
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mmproj_auto: Option<bool>,
    pub mmproj_url: String,
    /// 图像编码每批最大 token；None = 不下发（默认 1024）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtmd_batch_max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_timestamp_interval: Option<i32>,
    pub video_ffmpeg_dir: String,
    pub tags: String,

    // ---- batch / CPU affinity (batch variants) --------------------------
    /// 批次处理 CPU 亲和性掩码；空 = 不下发
    pub cpu_mask_batch: String,
    /// 批次处理 CPU 亲和性范围；空 = 不下发
    pub cpu_range_batch: String,
    /// 批次处理严格 CPU 放置 0/1；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_strict_batch: Option<i32>,
    /// 批次处理进程优先级 0..3；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prio_batch: Option<i32>,
    /// 批次处理轮询级别 0..100；None = 不下发（默认 50）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll_batch: Option<i32>,

    // ---- rope freq (NTK-aware) ------------------------------------------
    /// RoPE 基础频率；None = 不下发（默认读模型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rope_freq_base: Option<f64>,
    /// RoPE 频率缩放因子（按 1/N 扩展上下文）；None = 不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rope_freq_scale: Option<f64>,

    // ---- speculative decoding: draft KV cache types --------------------
    /// 草稿模型 KV 缓存 K 类型；None = 不下发（默认 f16）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_type_k: Option<String>,
    /// 草稿模型 KV 缓存 V 类型；None = 不下发（默认 f16）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_type_v: Option<String>,

    // ---- speculative decoding: draft CPU / perf ------------------------
    /// 草稿模型批处理线程数；None = 不下发（默认同 --threads）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_threads_batch: Option<i32>,
    /// 草稿模型 CPU 亲和性掩码；空 = 不下发
    pub spec_draft_cpu_mask: String,
    /// 草稿模型 CPU 亲和性范围；空 = 不下发
    pub spec_draft_cpu_range: String,
    /// 草稿模型严格 CPU 放置 0/1；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_cpu_strict: Option<i32>,
    /// 草稿模型进程优先级 0..3；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_prio: Option<i32>,
    /// 草稿模型轮询级别 0/1；None = 不下发（默认同 --poll）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_poll: Option<i32>,
    /// 草稿模型批处理 CPU 亲和性掩码；空 = 不下发
    pub spec_draft_cpu_mask_batch: String,
    /// 草稿模型批处理严格 CPU 放置 0/1；None = 不下发（默认同 --cpu-strict）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_cpu_strict_batch: Option<i32>,
    /// 草稿模型批处理进程优先级 0..3；None = 不下发（默认 0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_prio_batch: Option<i32>,
    /// 草稿模型批处理轮询级别 0/1；None = 不下发（默认同 --poll）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_poll_batch: Option<i32>,
    /// 草稿模型张量缓冲类型覆写；空 = 不下发
    pub spec_draft_override_tensor: String,
    /// 草稿模型后端采样；None=不下发(=默认:开), Some(true)=下发 --spec-draft-backend-sampling, Some(false)=下发 --no-spec-draft-backend-sampling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_draft_backend_sampling: Option<bool>,

    // ---- logging extras -------------------------------------------------
    /// 禁用日志；None=不下发(=默认:关), Some(true)=下发 --log-disable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_disable: Option<bool>,
    /// 内部 libllama 性能计时；None=不下发(=默认:关), Some(true)=下发 --perf, Some(false)=下发 --no-perf
    #[serde(skip_serializing_if = "Option::is_none")]
    pub perf: Option<bool>,

    // ---- inference behaviour --------------------------------------------
    /// 反向提示词：生成遇到该提示词即停止；空 = 不下发
    pub reverse_prompt: String,
    /// 处理转义序列(\n \r \t ' " \)；None=不下发(=默认:开), Some(true)=下发 --escape, Some(false)=下发 --no-escape
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escape: Option<bool>,

    // ---- WebUI / agent / tools ------------------------------------------
    /// WebUI 默认配置 JSON；空 = 不下发
    pub ui_config: String,
    /// WebUI 默认配置文件路径；空 = 不下发
    pub ui_config_file: String,
    /// WebUI MCP 代理；None=不下发(=默认:关), Some(true)=下发 --ui-mcp-proxy, Some(false)=下发 --no-ui-mcp-proxy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_mcp_proxy: Option<bool>,
    /// 内置工具列表（逗号分隔，可选 "all"）；空 = 不下发
    pub tools: String,
    /// 工具运行环境；空 = 不下发
    pub tools_runtime: String,
    /// MCP 服务器定义 JSON 文件路径；空 = 不下发
    pub mcp_servers_config: String,
    /// MCP 服务器定义内联 JSON；空 = 不下发
    pub mcp_servers_json: String,
    /// 智能体模式（启用 CORS 代理与全部内置工具）；None=不下发(=默认:关), Some(true)=下发 -ag, Some(false)=下发 --no-ag
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<bool>,

    // ---- reasoning extras -----------------------------------------------
    /// 思考预算耗尽时注入的消息；空 = 不下发
    pub reasoning_budget_message: String,

    // ---- misc ------------------------------------------------------------
    pub extra_args: String,
    pub kill_on_exit: bool,
    pub auto_open_browser: bool,
    /// 模型加载完成（服务就绪）后自动跳转到软件内的 WebUI 页。
    pub auto_goto_webui: bool,
    /// 启动服务前先终止上一次遗留的 llama-server 进程，释放其占用的显存。
    pub clean_vram_on_start: bool,

    // ---- meta ------------------------------------------------------------
    /// 用户显式修改过的参数键（camelCase，如 "ctxSize"）。
    /// 自动推荐（换模型 / 硬件变化）时跳过这些键，避免覆盖用户手动设置；
    /// 「恢复推荐值」即从该列表移除对应键。
    #[serde(default)]
    pub manual_params: Vec<String>,
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

            draft_model_path: String::new(),
            auto_draft: true,

            host: String::from("127.0.0.1"),
            port: 8080,
            parallel: None,
            cont_batching: None,
            timeout: None,
            threads_http: None,
            alias: String::new(),
            api_key: String::new(),
            metrics: None,
            props: None,
            slots_endpoint: None,
            webui: None,
            embedding: None,
            jinja: None,

            ctx_size: None,
            batch_size: None,
            ubatch_size: None,
            threads: None,
            threads_batch: None,
            // GPU 卸载是启动器的核心能力：即使未设置（空串）也按 auto 下发，
            // 避免 llama-server 退回全 CPU 推理。空串即「默认/未设置」，UI 显示「默认」。
            gpu_layers_mode: String::from(""),
            gpu_layers_value: 999,
            flash_attn: None,
            split_mode: None,
            tensor_split: String::new(),
            main_gpu: None,
            device: String::new(),
            kv_offload: None,
            cache_type_k: None,
            cache_type_v: None,
            load_mode: None,
            numa: String::new(),
            lora: String::new(),

            cache_prompt: None,
            cache_reuse: None,
            cpu_moe: None,
            n_cpu_moe: None,
            n_cpu_ffn: None,
            image_min_tokens: None,
            image_max_tokens: None,

            rope_scaling: String::from(""),
            rope_scale: None,
            yarn_orig_ctx: None,

            yarn_ext_factor: None,
            yarn_attn_factor: None,
            yarn_beta_slow: None,
            yarn_beta_fast: None,

            mmproj_offload: None,
            mmproj_device: String::new(),

            verbosity: None,
            // llama-server 默认不打时间戳；None = 不下发（与默认一致），
            // 仅当用户显式 Some(true) 时才下发 --log-timestamps。
            log_timestamps: None,
            log_file: String::new(),
            log_colors: String::new(),
            log_prefix: None,

            // ---- memory & capacity fitting ----
            fit: None,
            fit_target: String::new(),
            fit_ctx: None,
            cache_ram: None,
            kv_unified: None,
            kv_unified_per_slot: None,
            cache_idle_slots: None,
            swa_full: None,
            keep: None,
            context_shift: None,
            ctx_checkpoints: None,
            checkpoint_min_step: None,

            // ---- sampling ----
            predict: None,
            samplers: String::new(),
            sampler_seq: String::new(),
            seed: None,
            ignore_eos: None,
            temp: None,
            top_k: None,
            top_p: None,
            min_p: None,
            top_nsigma: None,
            xtc_probability: None,
            xtc_threshold: None,
            typical_p: None,
            repeat_last_n: None,
            repeat_penalty: None,
            presence_penalty: None,
            frequency_penalty: None,
            dry_multiplier: None,
            dry_base: None,
            dry_allowed_length: None,
            dry_penalty_last_n: None,
            dry_sequence_breaker: String::new(),
            adaptive_target: None,
            adaptive_decay: None,
            dynatemp_range: None,
            dynatemp_exp: None,
            mirostat: None,
            mirostat_lr: None,
            mirostat_ent: None,
            logit_bias: String::new(),
            grammar: String::new(),
            grammar_file: String::new(),
            json_schema: String::new(),
            json_schema_file: String::new(),
            backend_sampling: None,

            // ---- model loading & tensor control ----
            override_tensor: String::new(),
            repack: None,
            no_host: None,
            lazy_mode: None,
            direct_io: None,
            mlock: None,
            mmap: None,
            check_tensors: None,
            override_kv: String::new(),
            op_offload: None,
            rpc: String::new(),
            cpu_mask: String::new(),
            cpu_range: String::new(),
            cpu_strict: None,
            prio: None,
            poll: None,

            // ---- speculative decoding ----
            spec_type: String::new(),
            spec_draft_n_max: None,
            spec_draft_n_min: None,
            spec_draft_p_split: None,
            spec_draft_p_min: None,
            spec_draft_ngl: String::new(),
            spec_draft_device: String::new(),
            spec_draft_cpu_moe: None,
            spec_draft_n_cpu_moe: None,
            spec_draft_threads: None,
            spec_ngram_mod_n_min: None,
            spec_ngram_mod_n_max: None,
            spec_ngram_mod_n_match: None,
            spec_ngram_simple_size_n: None,
            spec_ngram_simple_size_m: None,
            spec_ngram_simple_min_hits: None,
            spec_ngram_map_k_size_n: None,
            spec_ngram_map_k_size_m: None,
            spec_ngram_map_k_min_hits: None,
            spec_ngram_map_k4v_size_n: None,
            spec_ngram_map_k4v_size_m: None,
            spec_ngram_map_k4v_min_hits: None,

            // ---- networking, security & endpoints ----
            reuse_port: None,
            api_prefix: String::new(),
            static_path: String::new(),
            cors_origins: String::new(),
            cors_methods: String::new(),
            cors_headers: String::new(),
            cors_credentials: None,
            ssl_key_file: String::new(),
            ssl_cert_file: String::new(),
            api_key_file: String::new(),
            sse_ping_interval: None,
            media_path: String::new(),
            slot_save_path: String::new(),
            models_dir: String::new(),
            models_preset: String::new(),
            models_max: None,
            models_autoload: None,
            rerank: None,
            sleep_idle_seconds: None,
            log_prompts_dir: String::new(),

            // ---- inference behaviour & templates ----
            chat_template: String::new(),
            chat_template_file: String::new(),
            chat_template_kwargs: String::new(),
            reasoning_format: String::new(),
            reasoning: None,
            reasoning_effort: String::new(),
            reasoning_budget: None,
            reasoning_preserve: None,
            skip_chat_parsing: None,
            prefill_assistant: None,
            pooling: String::new(),
            embd_normalize: None,
            slot_prompt_similarity: None,
            warmup: None,
            lookup_cache_static: String::new(),
            lookup_cache_dynamic: String::new(),
            lora_scaled: String::new(),
            lora_init_without_apply: None,
            control_vector: String::new(),
            control_vector_scaled: String::new(),
            control_vector_layer_range: String::new(),
            spm_infill: None,
            special: None,
            offline: None,

            // ---- multimodal & video ----
            mmproj_auto: None,
            mmproj_url: String::new(),
            mtmd_batch_max_tokens: None,
            video_fps: None,
            video_timestamp_interval: None,
            video_ffmpeg_dir: String::new(),
            tags: String::new(),

            // ---- batch / CPU affinity (batch variants) ------------------
            cpu_mask_batch: String::new(),
            cpu_range_batch: String::new(),
            cpu_strict_batch: None,
            prio_batch: None,
            poll_batch: None,

            // ---- rope freq (NTK-aware) ----------------------------------
            rope_freq_base: None,
            rope_freq_scale: None,

            // ---- speculative decoding: draft KV cache types ------------
            spec_draft_type_k: None,
            spec_draft_type_v: None,

            // ---- speculative decoding: draft CPU / perf ---------------
            spec_draft_threads_batch: None,
            spec_draft_cpu_mask: String::new(),
            spec_draft_cpu_range: String::new(),
            spec_draft_cpu_strict: None,
            spec_draft_prio: None,
            spec_draft_poll: None,
            spec_draft_cpu_mask_batch: String::new(),
            spec_draft_cpu_strict_batch: None,
            spec_draft_prio_batch: None,
            spec_draft_poll_batch: None,
            spec_draft_override_tensor: String::new(),
            spec_draft_backend_sampling: None,

            // ---- logging extras ----------------------------------------
            log_disable: None,
            perf: None,

            // ---- inference behaviour -----------------------------------
            reverse_prompt: String::new(),
            escape: None,

            // ---- WebUI / agent / tools ---------------------------------
            ui_config: String::new(),
            ui_config_file: String::new(),
            ui_mcp_proxy: None,
            tools: String::new(),
            tools_runtime: String::new(),
            mcp_servers_config: String::new(),
            mcp_servers_json: String::new(),
            agent: None,

            // ---- reasoning extras --------------------------------------
            reasoning_budget_message: String::new(),

            extra_args: String::new(),
            kill_on_exit: true,
            auto_open_browser: false,
            auto_goto_webui: true,
            clean_vram_on_start: true,

            manual_params: Vec::new(),
        }
    }
}

/// Persisted UI state that is not part of the launch configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// 配置结构版本。旧文件缺少该字段（读作 0）时会触发一次性迁移。
    pub schema_version: u32,
    pub config: LaunchConfig,
    pub last_model_root: String,
    /// 多个模型根目录（扫描时合并）。首项为当前主目录。
    pub model_libraries: Vec<String>,
    /// 用户保存的启动配置快照。
    pub profiles: Vec<ModelProfile>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            config: LaunchConfig::default(),
            last_model_root: LaunchConfig::default().model_root,
            model_libraries: vec![LaunchConfig::default().model_root],
            profiles: Vec::new(),
        }
    }
}
