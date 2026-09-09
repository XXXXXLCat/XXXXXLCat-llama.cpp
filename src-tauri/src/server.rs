use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::types::{LaunchConfig, LogLine, ServerStatus};

pub const EVENT_LOG: &str = "llama://log";
pub const EVENT_STATUS: &str = "llama://status";

const MAX_LOG_LINES: usize = 5000;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Runtime {
    child: Option<Child>,
    /// Bumped on every start/stop so that stale monitors terminate.
    gen: u64,
    pid: Option<u32>,
    started_at: Option<i64>,
    exit_code: Option<i32>,
    last_error: Option<String>,
    model_path: Option<String>,
    mmproj_path: Option<String>,
    endpoint: Option<String>,
}

impl Runtime {
    fn new() -> Self {
        Self {
            child: None,
            gen: 0,
            pid: None,
            started_at: None,
            exit_code: None,
            last_error: None,
            model_path: None,
            mmproj_path: None,
            endpoint: None,
        }
    }

    fn snapshot(&self) -> ServerStatus {
        ServerStatus {
            running: self.child.is_some(),
            pid: self.pid,
            started_at: self.started_at,
            exit_code: self.exit_code,
            last_error: self.last_error.clone(),
            model_path: self.model_path.clone(),
            mmproj_path: self.mmproj_path.clone(),
            endpoint: self.endpoint.clone(),
        }
    }
}

pub struct ServerManager {
    app: AppHandle,
    rt: Arc<Mutex<Runtime>>,
    logs: Arc<Mutex<VecDeque<LogLine>>>,
    seq: Arc<AtomicU64>,
}

impl ServerManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            rt: Arc::new(Mutex::new(Runtime::new())),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(512))),
            seq: Arc::new(AtomicU64::new(0)),
        }
    }

    fn lock_rt(&self) -> MutexGuard<'_, Runtime> {
        self.rt.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_logs(&self) -> MutexGuard<'_, VecDeque<LogLine>> {
        self.logs.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ------------------------------------------------------------------ log

    fn push_log(&self, stream: &str, text: &str) {
        let line = LogLine {
            id: self.seq.fetch_add(1, Ordering::Relaxed),
            ts: now_ms(),
            stream: stream.to_string(),
            text: strip_ansi(text),
        };

        {
            let mut logs = self.lock_logs();
            if logs.len() >= MAX_LOG_LINES {
                logs.pop_front();
            }
            logs.push_back(line.clone());
        }

        let _ = self.app.emit(EVENT_LOG, line);
    }

    pub fn logs(&self) -> Vec<LogLine> {
        self.lock_logs().iter().cloned().collect()
    }

    pub fn clear_logs(&self) {
        self.lock_logs().clear();
    }

    // --------------------------------------------------------------- status

    pub fn status(&self) -> ServerStatus {
        self.lock_rt().snapshot()
    }

    fn emit_status(&self) {
        let status = self.status();
        let _ = self.app.emit(EVENT_STATUS, status);
    }

    // ------------------------------------------------------------ lifecycle

    pub fn start(&self, cfg: &LaunchConfig) -> Result<(), String> {
        if self.lock_rt().child.is_some() {
            return Err("服务已在运行中，请先停止".to_string());
        }
        if cfg.model_path.trim().is_empty() {
            return Err("尚未选择主模型".to_string());
        }

        // 启动前清理上一次遗留的 llama-server 进程：Windows 无法直接释放显存，
        // 只能终止仍占用它的进程，避免残留进程吃满显存导致本次模型加载失败。
        if cfg.clean_vram_on_start {
            let killed = kill_stale_servers(cfg);
            if killed > 0 {
                self.push_log(
                    "system",
                    &format!("已清理 {killed} 个残留服务进程（释放显存）"),
                );
            }
        }

        let exe = resolve_server_bin(cfg)?;
        let args = build_args(cfg);
        let work_dir = PathBuf::from(&cfg.llama_dir);
        let endpoint = format!("http://{}:{}", client_host(&cfg.host), cfg.port);

        let mut cmd = Command::new(&exe);
        cmd.args(&args)
            .current_dir(&work_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动失败: {e}\n可执行文件: {}", exe.display()))?;

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        {
            let mut rt = self.lock_rt();
            rt.child = Some(child);
            rt.gen += 1;
            rt.pid = Some(pid);
            rt.started_at = Some(now_ms());
            rt.exit_code = None;
            rt.last_error = None;
            rt.model_path = Some(cfg.model_path.clone());
            rt.mmproj_path = Some(cfg.mmproj_path.clone());
            rt.endpoint = Some(endpoint.clone());
        }

        self.push_log(
            "system",
            &format!("$ {} {}", exe.display(), shell_join(&args)),
        );
        self.push_log("system", &format!("进程已启动 (pid={pid}) · {endpoint}"));

        // 启动中文注入代理：前端 /webui 经此代理访问 llama-server，自动注入翻译脚本。
        crate::webui_proxy::ensure_started(&endpoint);

        self.emit_status();

        if let Some(out) = stdout {
            let app = self.app.clone();
            let logs = Arc::clone(&self.logs);
            let seq = Arc::clone(&self.seq);
            std::thread::spawn(move || pump(out, "stdout", app, logs, seq));
        }
        if let Some(err) = stderr {
            let app = self.app.clone();
            let logs = Arc::clone(&self.logs);
            let seq = Arc::clone(&self.seq);
            std::thread::spawn(move || pump(err, "stderr", app, logs, seq));
        }

        self.spawn_monitor();
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut rt = self.lock_rt();
        rt.gen += 1;
        crate::webui_proxy::stop();
        match rt.child.as_mut() {
            Some(child) => {
                child.kill().map_err(|e| format!("终止进程失败: {e}"))?;
                let code = child.wait().ok().and_then(|s| s.code());
                rt.exit_code = code;
                rt.child = None;
                drop(rt);
                self.push_log("system", "已停止服务进程");
                self.emit_status();
                Ok(())
            }
            None => Err("服务当前未运行".to_string()),
        }
    }

    /// Invoked when the application exits.
    pub fn dispose(&self) {
        if self.lock_rt().child.is_some() {
            let _ = self.stop();
        }
    }

    fn spawn_monitor(&self) {
        let rt = Arc::clone(&self.rt);
        let app = self.app.clone();
        let logs = Arc::clone(&self.logs);
        let seq = Arc::clone(&self.seq);
        let gen = self.lock_rt().gen;

        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(400));

            let (finished, code) = {
                let mut guard = rt.lock().unwrap_or_else(|e| e.into_inner());
                if guard.gen != gen {
                    return;
                }
                match guard.child.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => {
                            guard.child = None;
                            guard.exit_code = status.code();
                            if let Some(c) = status.code() {
                                if c != 0 {
                                    guard.last_error = Some(format!("进程异常退出，退出码 {c}"));
                                }
                            }
                            (true, status.code())
                        }
                        Ok(None) => (false, None),
                        Err(_) => {
                            guard.child = None;
                            (true, None)
                        }
                    },
                    None => return,
                }
            };

            if finished {
                let line = LogLine {
                    id: seq.fetch_add(1, Ordering::Relaxed),
                    ts: now_ms(),
                    stream: "system".to_string(),
                    text: format!(
                        "进程已退出 (exit={})",
                        code.map_or_else(|| "?".to_string(), |c| c.to_string())
                    ),
                };
                logs.lock().unwrap_or_else(|e| e.into_inner()).push_back(line.clone());
                let _ = app.emit(EVENT_LOG, line);
                let _ = app.emit(
                    EVENT_STATUS,
                    rt.lock().unwrap_or_else(|e| e.into_inner()).snapshot(),
                );
                return;
            }
        });
    }
}

// --------------------------------------------------------------------- utils

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn pump<R: Read>(
    reader: R,
    stream: &'static str,
    app: AppHandle,
    logs: Arc<Mutex<VecDeque<LogLine>>>,
    seq: Arc<AtomicU64>,
) {
    let mut buf = BufReader::new(reader);
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match buf.read_until(b'\n', &mut raw) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        let text = String::from_utf8_lossy(&raw);
        let text = text.trim_end_matches(['\n', '\r']);
        if text.trim().is_empty() {
            continue;
        }
        let line = LogLine {
            id: seq.fetch_add(1, Ordering::Relaxed),
            ts: now_ms(),
            stream: stream.to_string(),
            text: strip_ansi(text),
        };
        {
            let mut guard = logs.lock().unwrap_or_else(|e| e.into_inner());
            if guard.len() >= MAX_LOG_LINES {
                guard.pop_front();
            }
            guard.push_back(line.clone());
        }
        let _ = app.emit(EVENT_LOG, line);
    }
}

/// Remove ANSI escape sequences — llama.cpp colourises its output.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Consume the escape sequence: `[` + params + final byte.
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// Resolve `llama-server` — accept either an absolute path or a bare file name
/// resolved against the configured llama.cpp directory.

/// 残留进程匹配的映像名：取 `server_bin` 的文件名，缺省 `llama-server.exe`。
fn stale_process_name(cfg: &LaunchConfig) -> String {
    let raw = cfg.server_bin.trim();
    let candidate = if raw.is_empty() {
        PathBuf::from("llama-server.exe")
    } else {
        PathBuf::from(raw)
    };
    candidate
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "llama-server.exe".to_string())
}

/// 启动前清理上一次遗留的 llama-server 进程，释放其占用的显存。
///
/// Windows 无法直接「释放显存」，只能终止仍占用它的进程。这里**按进程名**精确匹配
/// （取自 `server_bin` 的文件名），因此不会波及其他程序（浏览器、游戏、其他 AI 工具）。
/// 返回被终止的进程条数；未发现残留时返回 0。
/// 注：`start()` 已保证当前没有受管子进程，故不会误杀自己正在运行的服务。
#[cfg(windows)]
fn kill_stale_servers(cfg: &LaunchConfig) -> usize {
    let name = stale_process_name(cfg);
    if name.is_empty() {
        return 0;
    }
    let out = {
        use std::os::windows::process::CommandExt;
        Command::new("taskkill")
            .args(["/F", "/T", "/IM", &name])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };
    match out {
        // taskkill 每终止一个进程输出一行「成功: 已终止 PID 1234 ...」
        Ok(o) if o.status.success() => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            let n = text.lines().filter(|l| l.contains("PID")).count();
            if n > 0 { n } else { 1 }
        }
        // 退出码非 0 多为「未找到进程」，属正常情况，不算错误
        _ => 0,
    }
}

#[cfg(not(windows))]
fn kill_stale_servers(cfg: &LaunchConfig) -> usize {
    let name = stale_process_name(cfg);
    if name.is_empty() {
        return 0;
    }
    let _ = Command::new("pkill").args(["-f", &name]).output();
    0
}

fn resolve_server_bin(cfg: &LaunchConfig) -> Result<PathBuf, String> {
    let candidate = if cfg.server_bin.trim().is_empty() {
        PathBuf::from("llama-server.exe")
    } else {
        PathBuf::from(cfg.server_bin.trim())
    };

    if candidate.is_absolute() {
        if candidate.exists() {
            Ok(candidate)
        } else {
            Err(format!("找不到 llama-server: {}", candidate.display()))
        }
    } else {
        let joined = PathBuf::from(&cfg.llama_dir).join(&candidate);
        if joined.exists() {
            Ok(joined)
        } else if candidate.exists() {
            Ok(candidate)
        } else {
            Err(format!(
                "找不到 llama-server: {}\n请检查 llama.cpp 目录配置",
                joined.display()
            ))
        }
    }
}

/// 把「监听地址」换算为本机客户端真正能连上的地址。
///
/// `0.0.0.0` / `::` 是通配**绑定**地址，并非可连接地址：Windows 的
/// `connect()` 会直接以 WinError 10049 拒绝，浏览器同样无法加载
/// `http://0.0.0.0:8080`。因此探活与 Web UI 链接一律回落到 `127.0.0.1`，
/// 服务本身仍按原地址监听（局域网访问不受影响）。
pub fn client_host(host: &str) -> &str {
    match host.trim() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1",
        other => other,
    }
}

fn shell_join(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            if a.contains(' ') || a.contains('"') {
                format!("\"{}\"", a.replace('"', "\\\""))
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Split an extra-arguments string, honouring double quotes.
fn split_extra(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for c in input.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            other => cur.push(other),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Translate the launch configuration into llama-server command-line args.
// ------------------------------------------------------------ arg helpers

/// 追加 `--flag <value>`；`None` 或全空白一律不下发（沿用「未设置 = 不传参」）。
fn push_str(a: &mut Vec<String>, flag: &str, v: Option<&String>) {
    if let Some(s) = v.map(|x| x.trim()).filter(|s| !s.is_empty()) {
        a.push(flag.into());
        a.push(s.to_string());
    }
}

/// 追加整数型 `--flag <value>`。
fn push_num<T: std::fmt::Display>(a: &mut Vec<String>, flag: &str, v: Option<T>) {
    if let Some(n) = v {
        a.push(flag.into());
        a.push(n.to_string());
    }
}

/// 追加浮点型 `--flag <value>`：最多 6 位小数并去掉无意义的尾随 0，
/// 避免把 `0.8` 写成 `0.800000` 这类噪音。
fn push_f64(a: &mut Vec<String>, flag: &str, v: Option<f64>) {
    if let Some(n) = v {
        let s = format!("{:.6}", n);
        let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
        a.push(flag.into());
        a.push(if s.is_empty() { String::from("0") } else { s });
    }
}

pub fn build_args(cfg: &LaunchConfig) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();

    // ---- model -----------------------------------------------------------
    a.push("-m".into());
    a.push(cfg.model_path.clone());
    if !cfg.mmproj_path.trim().is_empty() {
        a.push("--mmproj".into());
        a.push(cfg.mmproj_path.clone());
    }
    if !cfg.draft_model_path.trim().is_empty() {
        a.push("--model-draft".into());
        a.push(cfg.draft_model_path.clone());
    }

    // ---- server ----------------------------------------------------------
    a.push("--host".into());
    a.push(cfg.host.clone());
    a.push("--port".into());
    a.push(cfg.port.to_string());
    // 未设置（None）一律不下发，交给 llama-server 自身默认值。
    if let Some(n) = cfg.parallel {
        a.push("-np".into());
        a.push(n.to_string());
    }
    // 三态：None=不下发(=默认:开)；Some(true)=保持开启(无正flag)；Some(false)=下发 `-nocb`。
    match cfg.cont_batching {
        Some(false) => a.push("-nocb".into()),
        _ => {}
    }
    if let Some(t) = cfg.timeout {
        a.push("-to".into());
        a.push(t.to_string());
    }
    if let Some(t) = cfg.threads_http {
        a.push("--threads-http".into());
        a.push(t.to_string());
    }
    if !cfg.alias.trim().is_empty() {
        a.push("-a".into());
        a.push(cfg.alias.trim().to_string());
    }
    if !cfg.api_key.trim().is_empty() {
        a.push("--api-key".into());
        a.push(cfg.api_key.trim().to_string());
    }
    // 三态：None=不下发(=默认:关)；Some(true)=下发 --metrics；Some(false)=无负flag,不下发。
    match cfg.metrics {
        Some(true) => a.push("--metrics".into()),
        _ => {}
    }
    match cfg.props {
        Some(true) => a.push("--props".into()),
        _ => {}
    }
    // 三态：None=不下发(=默认:开)；Some(true)=保持开启(无正flag)；Some(false)=下发 `--no-slots`。
    match cfg.slots_endpoint {
        Some(false) => a.push("--no-slots".into()),
        _ => {}
    }
    // 三态：None=不下发(=默认:开)；Some(true)=保持开启(无正flag)；Some(false)=下发 `--no-webui`。
    match cfg.webui {
        Some(false) => a.push("--no-webui".into()),
        _ => {}
    }
    match cfg.embedding {
        Some(true) => a.push("--embedding".into()),
        _ => {}
    }
    // 三态：None=不下发(=默认:开)；Some(true)=保持开启(无正flag)；Some(false)=下发 `--no-jinja`。
    match cfg.jinja {
        Some(false) => a.push("--no-jinja".into()),
        _ => {}
    }

    // ---- context & batching ---------------------------------------------
    if let Some(c) = cfg.ctx_size {
        a.push("-c".into());
        a.push(c.to_string());
    }
    if let Some(b) = cfg.batch_size {
        a.push("-b".into());
        a.push(b.to_string());
    }
    if let Some(u) = cfg.ubatch_size {
        a.push("-ub".into());
        a.push(u.to_string());
    }
    if let Some(t) = cfg.threads {
        a.push("-t".into());
        a.push(t.to_string());
    }
    if let Some(t) = cfg.threads_batch {
        a.push("-tb".into());
        a.push(t.to_string());
    }

    // ---- model loading / offload ----------------------------------------
    // GPU 卸载：选「默认」(空串) 时不下发 -ngl，由 llama.cpp 按自身 default:auto 自动卸载到 GPU；
    // 选 auto/all/custom 时显式下发。三种情况最终都走自动 GPU 卸载，不会退回纯 CPU 推理。
    match cfg.gpu_layers_mode.as_str() {
        "auto" => {
            a.push("-ngl".into());
            a.push("auto".into());
        }
        "all" => {
            a.push("-ngl".into());
            a.push("all".into());
        }
        "custom" => {
            a.push("-ngl".into());
            a.push(cfg.gpu_layers_value.to_string());
        }
        _ => {} // 空串/未知值：不下发，沿用 llama.cpp 默认（auto）
    }
    if let Some(fa) = cfg.flash_attn.as_deref().filter(|s| !s.trim().is_empty()) {
        a.push("-fa".into());
        a.push(fa.to_string());
    }
    if let Some(sm) = cfg.split_mode.as_deref().filter(|s| !s.trim().is_empty()) {
        a.push("-sm".into());
        a.push(sm.to_string());
    }
    if !cfg.tensor_split.trim().is_empty() {
        a.push("-ts".into());
        a.push(cfg.tensor_split.trim().to_string());
    }
    if let Some(mg) = cfg.main_gpu {
        a.push("-mg".into());
        a.push(mg.to_string());
    }
    if !cfg.device.trim().is_empty() {
        a.push("-dev".into());
        a.push(cfg.device.trim().to_string());
    }
    // 三态：None=不下发(=默认:开)；Some(true)=下发 --kv-offload；Some(false)=下发 -nkvo。
    match cfg.kv_offload {
        Some(true) => a.push("--kv-offload".into()),
        Some(false) => a.push("-nkvo".into()),
        None => {}
    }
    if let Some(ctk) = cfg.cache_type_k.as_deref().filter(|s| !s.trim().is_empty()) {
        a.push("-ctk".into());
        a.push(ctk.to_string());
    }
    if let Some(ctv) = cfg.cache_type_v.as_deref().filter(|s| !s.trim().is_empty()) {
        a.push("-ctv".into());
        a.push(ctv.to_string());
    }
    if let Some(lm) = cfg.load_mode.as_deref().filter(|s| !s.trim().is_empty()) {
        a.push("-lm".into());
        a.push(lm.to_string());
    }
    if !cfg.numa.trim().is_empty() {
        a.push("--numa".into());
        a.push(cfg.numa.trim().to_string());
    }
    if !cfg.lora.trim().is_empty() {
        a.push("--lora".into());
        a.push(cfg.lora.trim().to_string());
    }

    // ---- model loading extras -------------------------------------------
    // 三态：None=不下发(=默认:开)；Some(true)=保持开启(无正flag)；Some(false)=下发 `--no-cache-prompt`。
    match cfg.cache_prompt {
        Some(false) => a.push("--no-cache-prompt".into()),
        _ => {}
    }
    if let Some(v) = cfg.cache_reuse {
        a.push("--cache-reuse".into());
        a.push(v.to_string());
    }
    match cfg.cpu_moe {
        Some(true) => a.push("--cpu-moe".into()),
        _ => {}
    }
    if let Some(v) = cfg.n_cpu_moe {
        a.push("--n-cpu-moe".into());
        a.push(v.to_string());
    }
    if let Some(v) = cfg.n_cpu_ffn {
        a.push("--n-cpu-ffn".into());
        a.push(v.to_string());
    }
    if let Some(v) = cfg.image_min_tokens {
        a.push("--image-min-tokens".into());
        a.push(v.to_string());
    }
    if let Some(v) = cfg.image_max_tokens {
        a.push("--image-max-tokens".into());
        a.push(v.to_string());
    }

    // ---- rope ------------------------------------------------------------
    if cfg.rope_scaling != "none" && !cfg.rope_scaling.trim().is_empty() {
        a.push("--rope-scaling".into());
        a.push(cfg.rope_scaling.clone());
    }
    if let Some(v) = cfg.rope_scale {
        a.push("--rope-scale".into());
        a.push(format!("{:.4}", v));
    }
    if let Some(v) = cfg.rope_freq_base {
        a.push("--rope-freq-base".into());
        a.push(format!("{:.4}", v));
    }
    if let Some(v) = cfg.rope_freq_scale {
        a.push("--rope-freq-scale".into());
        a.push(format!("{:.4}", v));
    }
    if let Some(v) = cfg.yarn_orig_ctx {
        if v > 0 {
            a.push("--yarn-orig-ctx".into());
            a.push(v.to_string());
        }
    }

    // ---- rope extras -----------------------------------------------------
    if let Some(v) = cfg.yarn_ext_factor {
        a.push("--yarn-ext-factor".into());
        a.push(format!("{:.4}", v));
    }
    if let Some(v) = cfg.yarn_attn_factor {
        a.push("--yarn-attn-factor".into());
        a.push(format!("{:.4}", v));
    }
    if let Some(v) = cfg.yarn_beta_slow {
        a.push("--yarn-beta-slow".into());
        a.push(format!("{:.4}", v));
    }
    if let Some(v) = cfg.yarn_beta_fast {
        a.push("--yarn-beta-fast".into());
        a.push(format!("{:.4}", v));
    }

    // ---- multimodal ------------------------------------------------------
    if !cfg.mmproj_path.trim().is_empty() {
        // 三态：None=不下发(=默认:开)；Some(true)=保持开启(无正flag)；Some(false)=下发 `--no-mmproj-offload`。
        match cfg.mmproj_offload {
            Some(false) => a.push("--no-mmproj-offload".into()),
            _ => {}
        }
        if !cfg.mmproj_device.trim().is_empty() {
            a.push("-mmdev".into());
            a.push(cfg.mmproj_device.trim().to_string());
        }
    }

    // ---- logging ---------------------------------------------------------
    // 日志着色：默认(空串)不下发 --log-colors，交由 llama.cpp 按自身 default:auto 处理；
    // 用户可在设置页显式选 on/off/auto。三种情况最终都会走 llama.cpp 的自动着色策略，
    // 不会退回无着色的纯文本（off 仅是其中一种可选项，不再强制默认下发）。
    match cfg.log_colors.as_str() {
        "on" | "off" | "auto" => {
            a.push("--log-colors".into());
            a.push(cfg.log_colors.clone());
        }
        _ => {} // 空串/未知值：不下发，沿用 llama.cpp 默认
    }
    if let Some(v) = cfg.verbosity {
        a.push("-lv".into());
        a.push(v.to_string());
    }
    match cfg.log_timestamps {
        Some(true) => a.push("--log-timestamps".into()),
        _ => {}
    }
    if !cfg.log_file.trim().is_empty() {
        a.push("--log-file".into());
        a.push(cfg.log_file.trim().to_string());
    }

    // ---- logging extras --------------------------------------------------
    // 三态：None=不下发(=默认:开)；Some(true)=无正flag；Some(false)=下发 `--no-log-prefix`。
    match cfg.log_prefix {
        Some(false) => a.push("--no-log-prefix".into()),
        _ => {}
    }

    // ---- memory & capacity fitting --------------------------------------
    push_str(&mut a, "--fit", cfg.fit.as_ref());
    push_str(&mut a, "--fit-target", Some(&cfg.fit_target));
    push_num(&mut a, "--fit-ctx", cfg.fit_ctx);
    push_num(&mut a, "--cache-ram", cfg.cache_ram);
    match cfg.kv_unified {
        Some(true) => a.push("-kvu".into()),
        Some(false) => a.push("-no-kvu".into()),
        None => {}
    }
    push_num(&mut a, "--kv-unified-per-slot", cfg.kv_unified_per_slot);
    match cfg.cache_idle_slots {
        Some(false) => a.push("--no-cache-idle-slots".into()),
        _ => {}
    }
    match cfg.swa_full {
        Some(true) => a.push("--swa-full".into()),
        _ => {}
    }
    push_num(&mut a, "--keep", cfg.keep);
    match cfg.context_shift {
        Some(true) => a.push("--context-shift".into()),
        _ => {}
    }
    push_num(&mut a, "--ctx-checkpoints", cfg.ctx_checkpoints);
    push_num(&mut a, "--checkpoint-min-step", cfg.checkpoint_min_step);

    // ---- sampling (server-side defaults) ---------------------------------
    push_num(&mut a, "-n", cfg.predict);
    push_str(&mut a, "--samplers", Some(&cfg.samplers));
    push_str(&mut a, "--sampler-seq", Some(&cfg.sampler_seq));
    push_num(&mut a, "-s", cfg.seed);
    if cfg.ignore_eos == Some(true) {
        a.push("--ignore-eos".into());
    }
    push_f64(&mut a, "--temp", cfg.temp);
    push_num(&mut a, "--top-k", cfg.top_k);
    push_f64(&mut a, "--top-p", cfg.top_p);
    push_f64(&mut a, "--min-p", cfg.min_p);
    push_f64(&mut a, "--top-nsigma", cfg.top_nsigma);
    push_f64(&mut a, "--xtc-probability", cfg.xtc_probability);
    push_f64(&mut a, "--xtc-threshold", cfg.xtc_threshold);
    push_f64(&mut a, "--typical", cfg.typical_p);
    push_num(&mut a, "--repeat-last-n", cfg.repeat_last_n);
    push_f64(&mut a, "--repeat-penalty", cfg.repeat_penalty);
    push_f64(&mut a, "--presence-penalty", cfg.presence_penalty);
    push_f64(&mut a, "--frequency-penalty", cfg.frequency_penalty);
    push_f64(&mut a, "--dry-multiplier", cfg.dry_multiplier);
    push_f64(&mut a, "--dry-base", cfg.dry_base);
    push_num(&mut a, "--dry-allowed-length", cfg.dry_allowed_length);
    push_num(&mut a, "--dry-penalty-last-n", cfg.dry_penalty_last_n);
    push_str(&mut a, "--dry-sequence-breaker", Some(&cfg.dry_sequence_breaker));
    push_f64(&mut a, "--adaptive-target", cfg.adaptive_target);
    push_f64(&mut a, "--adaptive-decay", cfg.adaptive_decay);
    push_f64(&mut a, "--dynatemp-range", cfg.dynatemp_range);
    push_f64(&mut a, "--dynatemp-exp", cfg.dynatemp_exp);
    push_num(&mut a, "--mirostat", cfg.mirostat);
    push_f64(&mut a, "--mirostat-lr", cfg.mirostat_lr);
    push_f64(&mut a, "--mirostat-ent", cfg.mirostat_ent);
    push_str(&mut a, "-l", Some(&cfg.logit_bias));
    push_str(&mut a, "--grammar", Some(&cfg.grammar));
    push_str(&mut a, "--grammar-file", Some(&cfg.grammar_file));
    push_str(&mut a, "-j", Some(&cfg.json_schema));
    push_str(&mut a, "-jf", Some(&cfg.json_schema_file));
    if cfg.backend_sampling == Some(true) {
        a.push("-bs".into());
    }

    // ---- model loading & tensor control ---------------------------------
    push_str(&mut a, "-ot", Some(&cfg.override_tensor));
    if cfg.repack == Some(false) {
        a.push("-nr".into());
    }
    if cfg.no_host == Some(true) {
        a.push("--no-host".into());
    }
    push_str(&mut a, "-lzm", cfg.lazy_mode.as_ref());
    match cfg.direct_io {
        Some(true) => a.push("-dio".into()),
        Some(false) => a.push("-ndio".into()),
        None => {}
    }
    if cfg.mlock == Some(true) {
        a.push("--mlock".into());
    }
    if cfg.mmap == Some(false) {
        a.push("--no-mmap".into());
    }
    if cfg.check_tensors == Some(true) {
        a.push("--check-tensors".into());
    }
    push_str(&mut a, "--override-kv", Some(&cfg.override_kv));
    if cfg.op_offload == Some(false) {
        a.push("--no-op-offload".into());
    }
    push_str(&mut a, "--rpc", Some(&cfg.rpc));
    push_str(&mut a, "-C", Some(&cfg.cpu_mask));
    push_str(&mut a, "-Cr", Some(&cfg.cpu_range));
    push_num(&mut a, "--cpu-strict", cfg.cpu_strict);
    push_num(&mut a, "--prio", cfg.prio);
    push_num(&mut a, "--poll", cfg.poll);

    // ---- batch-stage CPU affinity --------------------------------------
    push_str(&mut a, "--cpu-mask-batch", Some(&cfg.cpu_mask_batch));
    push_str(&mut a, "--cpu-range-batch", Some(&cfg.cpu_range_batch));
    push_num(&mut a, "--cpu-strict-batch", cfg.cpu_strict_batch);
    push_num(&mut a, "--prio-batch", cfg.prio_batch);
    push_num(&mut a, "--poll-batch", cfg.poll_batch);

    // ---- speculative decoding -------------------------------------------
    push_str(&mut a, "--spec-type", Some(&cfg.spec_type));
    push_num(&mut a, "--spec-draft-n-max", cfg.spec_draft_n_max);
    push_num(&mut a, "--spec-draft-n-min", cfg.spec_draft_n_min);
    push_f64(&mut a, "--draft-p-split", cfg.spec_draft_p_split);
    push_f64(&mut a, "--draft-p-min", cfg.spec_draft_p_min);
    push_str(&mut a, "-ngld", Some(&cfg.spec_draft_ngl));
    push_str(&mut a, "-devd", Some(&cfg.spec_draft_device));
    if cfg.spec_draft_cpu_moe == Some(true) {
        a.push("-cmoed".into());
    }
    push_num(&mut a, "-ncmoed", cfg.spec_draft_n_cpu_moe);
    push_num(&mut a, "-td", cfg.spec_draft_threads);
    push_str(&mut a, "--spec-draft-type-k", cfg.spec_draft_type_k.as_ref());
    push_str(&mut a, "--spec-draft-type-v", cfg.spec_draft_type_v.as_ref());
    push_num(&mut a, "--spec-draft-threads-batch", cfg.spec_draft_threads_batch);
    push_str(&mut a, "--spec-draft-cpu-mask", Some(&cfg.spec_draft_cpu_mask));
    push_str(&mut a, "--spec-draft-cpu-range", Some(&cfg.spec_draft_cpu_range));
    push_num(&mut a, "--cpu-strict-draft", cfg.spec_draft_cpu_strict);
    push_num(&mut a, "--prio-draft", cfg.spec_draft_prio);
    push_num(&mut a, "--poll-draft", cfg.spec_draft_poll);
    push_str(&mut a, "--spec-draft-cpu-mask-batch", Some(&cfg.spec_draft_cpu_mask_batch));
    push_num(&mut a, "--cpu-strict-batch-draft", cfg.spec_draft_cpu_strict_batch);
    push_num(&mut a, "--prio-batch-draft", cfg.spec_draft_prio_batch);
    push_num(&mut a, "--poll-batch-draft", cfg.spec_draft_poll_batch);
    push_str(&mut a, "--spec-draft-override-tensor", Some(&cfg.spec_draft_override_tensor));
    match cfg.spec_draft_backend_sampling {
        Some(true) => a.push("--spec-draft-backend-sampling".into()),
        Some(false) => a.push("--no-spec-draft-backend-sampling".into()),
        None => {}
    }
    push_num(&mut a, "--spec-ngram-mod-n-min", cfg.spec_ngram_mod_n_min);
    push_num(&mut a, "--spec-ngram-mod-n-max", cfg.spec_ngram_mod_n_max);
    push_num(&mut a, "--spec-ngram-mod-n-match", cfg.spec_ngram_mod_n_match);
    push_num(&mut a, "--spec-ngram-simple-size-n", cfg.spec_ngram_simple_size_n);
    push_num(&mut a, "--spec-ngram-simple-size-m", cfg.spec_ngram_simple_size_m);
    push_num(&mut a, "--spec-ngram-simple-min-hits", cfg.spec_ngram_simple_min_hits);
    push_num(&mut a, "--spec-ngram-map-k-size-n", cfg.spec_ngram_map_k_size_n);
    push_num(&mut a, "--spec-ngram-map-k-size-m", cfg.spec_ngram_map_k_size_m);
    push_num(&mut a, "--spec-ngram-map-k-min-hits", cfg.spec_ngram_map_k_min_hits);
    push_num(&mut a, "--spec-ngram-map-k4v-size-n", cfg.spec_ngram_map_k4v_size_n);
    push_num(&mut a, "--spec-ngram-map-k4v-size-m", cfg.spec_ngram_map_k4v_size_m);
    push_num(&mut a, "--spec-ngram-map-k4v-min-hits", cfg.spec_ngram_map_k4v_min_hits);

    // ---- networking, security & endpoints -------------------------------
    if cfg.reuse_port == Some(true) {
        a.push("--reuse-port".into());
    }
    push_str(&mut a, "--api-prefix", Some(&cfg.api_prefix));
    push_str(&mut a, "--path", Some(&cfg.static_path));
    push_str(&mut a, "--cors-origins", Some(&cfg.cors_origins));
    push_str(&mut a, "--cors-methods", Some(&cfg.cors_methods));
    push_str(&mut a, "--cors-headers", Some(&cfg.cors_headers));
    if cfg.cors_credentials == Some(false) {
        a.push("--no-cors-credentials".into());
    }
    push_str(&mut a, "--ssl-key-file", Some(&cfg.ssl_key_file));
    push_str(&mut a, "--ssl-cert-file", Some(&cfg.ssl_cert_file));
    push_str(&mut a, "--api-key-file", Some(&cfg.api_key_file));
    push_num(&mut a, "--sse-ping-interval", cfg.sse_ping_interval);
    push_str(&mut a, "--media-path", Some(&cfg.media_path));
    push_str(&mut a, "--slot-save-path", Some(&cfg.slot_save_path));
    push_str(&mut a, "--models-dir", Some(&cfg.models_dir));
    push_str(&mut a, "--models-preset", Some(&cfg.models_preset));
    push_num(&mut a, "--models-max", cfg.models_max);
    if cfg.models_autoload == Some(false) {
        a.push("--no-models-autoload".into());
    }
    if cfg.rerank == Some(true) {
        a.push("--reranking".into());
    }
    push_num(&mut a, "--sleep-idle-seconds", cfg.sleep_idle_seconds);
    push_str(&mut a, "--log-prompts-dir", Some(&cfg.log_prompts_dir));

    // ---- inference behaviour & templates --------------------------------
    push_str(&mut a, "--chat-template", Some(&cfg.chat_template));
    push_str(&mut a, "--chat-template-file", Some(&cfg.chat_template_file));
    push_str(&mut a, "--chat-template-kwargs", Some(&cfg.chat_template_kwargs));
    push_str(&mut a, "--reasoning-format", Some(&cfg.reasoning_format));
    push_str(&mut a, "-rea", cfg.reasoning.as_ref());
    push_str(&mut a, "--reasoning-effort", Some(&cfg.reasoning_effort));
    push_num(&mut a, "--reasoning-budget", cfg.reasoning_budget);
    push_str(&mut a, "--reasoning-budget-message", Some(&cfg.reasoning_budget_message));
    if cfg.reasoning_preserve == Some(false) {
        a.push("--no-reasoning-preserve".into());
    }
    if cfg.skip_chat_parsing == Some(true) {
        a.push("--skip-chat-parsing".into());
    }
    if cfg.prefill_assistant == Some(false) {
        a.push("--no-prefill-assistant".into());
    }
    push_str(&mut a, "--pooling", Some(&cfg.pooling));
    push_num(&mut a, "--embd-normalize", cfg.embd_normalize);
    push_f64(&mut a, "--slot-prompt-similarity", cfg.slot_prompt_similarity);
    if cfg.warmup == Some(false) {
        a.push("--no-warmup".into());
    }
    push_str(&mut a, "-lcs", Some(&cfg.lookup_cache_static));
    push_str(&mut a, "-lcd", Some(&cfg.lookup_cache_dynamic));
    push_str(&mut a, "--lora-scaled", Some(&cfg.lora_scaled));
    if cfg.lora_init_without_apply == Some(true) {
        a.push("--lora-init-without-apply".into());
    }
    push_str(&mut a, "--control-vector", Some(&cfg.control_vector));
    push_str(&mut a, "--control-vector-scaled", Some(&cfg.control_vector_scaled));
    push_str(
        &mut a,
        "--control-vector-layer-range",
        Some(&cfg.control_vector_layer_range),
    );
    if cfg.spm_infill == Some(true) {
        a.push("--spm-infill".into());
    }
    if cfg.special == Some(true) {
        a.push("-sp".into());
    }
    if cfg.offline == Some(true) {
        a.push("--offline".into());
    }
    push_str(&mut a, "-r", Some(&cfg.reverse_prompt));
    match cfg.escape {
        Some(true) => a.push("--escape".into()),
        Some(false) => a.push("--no-escape".into()),
        None => {}
    }
    if cfg.log_disable == Some(true) {
        a.push("--log-disable".into());
    }
    match cfg.perf {
        Some(true) => a.push("--perf".into()),
        Some(false) => a.push("--no-perf".into()),
        None => {}
    }

    // ---- multimodal & video ---------------------------------------------
    if cfg.mmproj_auto == Some(false) {
        a.push("--no-mmproj".into());
    }
    push_str(&mut a, "--mmproj-url", Some(&cfg.mmproj_url));
    push_num(&mut a, "--mtmd-batch-max-tokens", cfg.mtmd_batch_max_tokens);
    push_f64(&mut a, "--video-fps", cfg.video_fps);
    push_num(&mut a, "--video-timestamp-interval", cfg.video_timestamp_interval);
    push_str(&mut a, "--video-ffmpeg-dir", Some(&cfg.video_ffmpeg_dir));
    push_str(&mut a, "--tags", Some(&cfg.tags));

    // ---- WebUI / agent / tools -----------------------------------------
    push_str(&mut a, "--ui-config", Some(&cfg.ui_config));
    push_str(&mut a, "--ui-config-file", Some(&cfg.ui_config_file));
    match cfg.ui_mcp_proxy {
        Some(true) => a.push("--ui-mcp-proxy".into()),
        Some(false) => a.push("--no-ui-mcp-proxy".into()),
        None => {}
    }
    push_str(&mut a, "--tools", Some(&cfg.tools));
    push_str(&mut a, "--tools-runtime", Some(&cfg.tools_runtime));
    push_str(&mut a, "--mcp-servers-config", Some(&cfg.mcp_servers_config));
    push_str(&mut a, "--mcp-servers-json", Some(&cfg.mcp_servers_json));
    match cfg.agent {
        Some(true) => a.push("-ag".into()),
        Some(false) => a.push("--no-ag".into()),
        None => {}
    }

    a.extend(split_extra(&cfg.extra_args));
    a
}

#[cfg(test)]
mod tests {
    use super::{build_args, client_host};

    #[test]
    fn wildcard_bind_addresses_fall_back_to_loopback() {
        // 通配绑定地址不可连接：Windows connect() 会以 WinError 10049 拒绝，
        // 浏览器也无法加载 http://0.0.0.0:PORT。
        assert_eq!(client_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(client_host("::"), "127.0.0.1");
        assert_eq!(client_host("[::]"), "127.0.0.1");
        assert_eq!(client_host(""), "127.0.0.1");
        assert_eq!(client_host("   "), "127.0.0.1");
    }

    #[test]
    fn concrete_addresses_are_preserved() {
        assert_eq!(client_host("127.0.0.1"), "127.0.0.1");
        assert_eq!(client_host("localhost"), "localhost");
        assert_eq!(client_host("192.168.1.20"), "192.168.1.20");
    }

    /// 扩展参数（显存适配 / 采样 / 张量 / 投机解码 / 网络 / 模板 / 多模态）
    /// 一旦被显式设置就必须出现在命令行里，且浮点值不应带上多余的尾随 0。
    #[test]
    fn extended_params_are_emitted() {
        use crate::types::LaunchConfig;

        let mut cfg = LaunchConfig::default();
        cfg.model_path = String::from("dummy.gguf");
        cfg.fit = Some(String::from("off"));
        cfg.cache_ram = Some(4096);
        cfg.temp = Some(0.7);
        cfg.min_p = Some(0.05);
        cfg.mirostat = Some(2);
        cfg.override_tensor = String::from("blk.*=CPU");
        cfg.check_tensors = Some(true);
        cfg.spec_type = String::from("draft-mtp");
        cfg.spec_draft_n_max = Some(8);
        cfg.cors_origins = String::from("http://localhost:5173");
        cfg.rerank = Some(true);
        cfg.reasoning_effort = String::from("high");
        cfg.video_fps = Some(2.5);

        let joined = build_args(&cfg).join(" ");
        for expect in [
            "--fit off",
            "--cache-ram 4096",
            "--temp 0.7",
            "--min-p 0.05",
            "--mirostat 2",
            "-ot blk.*=CPU",
            "--check-tensors",
            "--spec-type draft-mtp",
            "--spec-draft-n-max 8",
            "--cors-origins http://localhost:5173",
            "--reranking",
            "--reasoning-effort high",
            "--video-fps 2.5",
        ] {
            assert!(joined.contains(expect), "missing: {expect}\n{joined}");
        }
    }

    // 「未设置 = 不下发」：默认配置只应产出模型/监听这几项必要参数，
    // 其余可选项（含 -ngl）一律交给 llama-server 自身默认值（llama.cpp -ngl 默认即 auto）。
    #[test]
    fn defaults_emit_no_optional_params() {
        use crate::types::LaunchConfig;

        let mut cfg = LaunchConfig::default();
        cfg.model_path = String::from("dummy.gguf");

        let args = build_args(&cfg);

        // 必要项必须存在
        assert!(args.contains(&"-m".to_string()));
        assert!(args.contains(&"--host".to_string()));
        assert!(args.contains(&"--port".to_string()));
        // GPU 卸载改由 llama.cpp 自身 default:auto 负责，未设置时不显式下发 -ngl
        assert!(!args.iter().any(|a| a == "-ngl"));

        // 未设置的可选项一律不下发
        for flag in [
            "-np",
            "-nocb",
            "-to",
            "--threads-http",
            "--no-slots",
            "--no-webui",
            "--no-jinja",
            "-c",
            "-b",
            "-ub",
            "-t",
            "-tb",
            "-fa",
            "-sm",
            "-mg",
            "-nkvo",
            "-ctk",
            "-ctv",
            "-lm",
            "--no-cache-prompt",
            "--cache-reuse",
            "--n-cpu-moe",
            "--n-cpu-ffn",
            "--image-min-tokens",
            "--image-max-tokens",
            "--rope-scaling",
            "--rope-scale",
            "--yarn-orig-ctx",
            "--yarn-ext-factor",
            "--yarn-attn-factor",
            "--yarn-beta-slow",
            "--yarn-beta-fast",
            "-lv",
            "--log-timestamps",
        ] {
            assert!(
                !args.iter().any(|a| a == flag),
                "默认配置不应下发 {flag}，实际参数：{args:?}"
            );
        }
    }

    // -ngl 仅在选择 auto/all/custom 时显式下发；「默认」(空串) 不下发，
    // 由 llama.cpp 按自身 default:auto 自动卸载到 GPU。
    #[test]
    fn gpu_layers_mode_emits_ngl() {
        use crate::types::LaunchConfig;

        // 默认(空串)：不下发 -ngl
        let mut cfg = LaunchConfig::default();
        cfg.model_path = String::from("dummy.gguf");
        let args = build_args(&cfg);
        assert!(!args.iter().any(|a| a == "-ngl"));

        // auto：显式 -ngl auto
        cfg.gpu_layers_mode = String::from("auto");
        let args = build_args(&cfg);
        let pos = args.iter().position(|a| a == "-ngl").expect("-ngl 应下发");
        assert_eq!(args[pos + 1], "auto");

        // all：显式 -ngl all
        cfg.gpu_layers_mode = String::from("all");
        let args = build_args(&cfg);
        let pos = args.iter().position(|a| a == "-ngl").expect("-ngl 应下发");
        assert_eq!(args[pos + 1], "all");

        // custom：显式 -ngl <value>
        cfg.gpu_layers_mode = String::from("custom");
        cfg.gpu_layers_value = 42;
        let args = build_args(&cfg);
        let pos = args.iter().position(|a| a == "-ngl").expect("-ngl 应下发");
        assert_eq!(args[pos + 1], "42");
    }

    // --log-colors 由设置项控制，默认(空串)不下发(沿用 llama.cpp default:auto)；可选 on/off/auto。
    #[test]
    fn log_colors_setting() {
        use crate::types::LaunchConfig;

        // 默认(空串)：不下发 --log-colors（交由 llama.cpp 按 default:auto 处理）
        let mut cfg = LaunchConfig::default();
        cfg.model_path = String::from("dummy.gguf");
        let args = build_args(&cfg);
        assert!(
            !args.iter().any(|a| a == "--log-colors"),
            "默认(空串)不应下发 --log-colors"
        );

        // 显式 on
        cfg.log_colors = String::from("on");
        let args = build_args(&cfg);
        let pos = args
            .iter()
            .position(|a| a == "--log-colors")
            .expect("--log-colors 应下发");
        assert_eq!(args[pos + 1], "on");

        // 显式 auto
        cfg.log_colors = String::from("auto");
        let args = build_args(&cfg);
        let pos = args
            .iter()
            .position(|a| a == "--log-colors")
            .expect("--log-colors 应下发");
        assert_eq!(args[pos + 1], "auto");
    }

    // 验证「参数设置」新增的服务端参数确实会进入启动命令行，而非仅停留在数据模型。
    #[test]
    fn server_only_params_are_emitted() {
        use crate::types::LaunchConfig;

        let mut cfg = LaunchConfig::default();
        cfg.model_path = String::from("dummy.gguf");
        cfg.lora = String::from("adapter.bin");
        cfg.cache_prompt = Some(false);
        cfg.cache_reuse = Some(4);
        cfg.cpu_moe = Some(true);
        cfg.n_cpu_moe = Some(2);
        cfg.n_cpu_ffn = Some(3);
        cfg.image_min_tokens = Some(100);
        cfg.image_max_tokens = Some(2000);
        cfg.rope_scaling = String::from("yarn");
        cfg.yarn_ext_factor = Some(1.1);
        cfg.yarn_attn_factor = Some(1.2);
        cfg.yarn_beta_slow = Some(1.3);
        cfg.yarn_beta_fast = Some(1.4);

        let args = build_args(&cfg);

        // LoRA
        let lora = args.iter().position(|a| a == "--lora").unwrap();
        assert_eq!(args[lora + 1], "adapter.bin");

        // 提示缓存（默认开启，仅关闭时下发否定形式）
        assert!(args.contains(&"--no-cache-prompt".to_string()));
        let cr = args.iter().position(|a| a == "--cache-reuse").unwrap();
        assert_eq!(args[cr + 1], "4");

        // MoE / FFN 放 CPU
        assert!(args.contains(&"--cpu-moe".to_string()));
        let ncm = args.iter().position(|a| a == "--n-cpu-moe").unwrap();
        assert_eq!(args[ncm + 1], "2");
        let ncf = args.iter().position(|a| a == "--n-cpu-ffn").unwrap();
        assert_eq!(args[ncf + 1], "3");

        // 图像 token 预算
        let imin = args.iter().position(|a| a == "--image-min-tokens").unwrap();
        assert_eq!(args[imin + 1], "100");
        let imax = args.iter().position(|a| a == "--image-max-tokens").unwrap();
        assert_eq!(args[imax + 1], "2000");

        // 完整 YaRN 控制（仅在 rope-scaling=yarn 时由 UI 暴露）
        assert!(args.contains(&"--yarn-ext-factor".to_string()));
        assert!(args.contains(&"--yarn-attn-factor".to_string()));
        assert!(args.contains(&"--yarn-beta-slow".to_string()));
        assert!(args.contains(&"--yarn-beta-fast".to_string()));
        let yef = args.iter().position(|a| a == "--yarn-ext-factor").unwrap();
        assert_eq!(args[yef + 1], "1.1000");
    }
}
