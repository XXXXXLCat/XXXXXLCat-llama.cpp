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
pub fn build_args(cfg: &LaunchConfig) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();

    // ---- model -----------------------------------------------------------
    a.push("-m".into());
    a.push(cfg.model_path.clone());
    if !cfg.mmproj_path.trim().is_empty() {
        a.push("--mmproj".into());
        a.push(cfg.mmproj_path.clone());
    }

    // ---- server ----------------------------------------------------------
    a.push("--host".into());
    a.push(cfg.host.clone());
    a.push("--port".into());
    a.push(cfg.port.to_string());
    a.push("-np".into());
    a.push(cfg.parallel.to_string());
    a.push(if cfg.cont_batching { "-cb" } else { "-nocb" }.into());
    a.push("-to".into());
    a.push(cfg.timeout.to_string());
    if cfg.threads_http != -1 {
        a.push("--threads-http".into());
        a.push(cfg.threads_http.to_string());
    }
    if !cfg.alias.trim().is_empty() {
        a.push("-a".into());
        a.push(cfg.alias.trim().to_string());
    }
    if !cfg.api_key.trim().is_empty() {
        a.push("--api-key".into());
        a.push(cfg.api_key.trim().to_string());
    }
    if cfg.metrics {
        a.push("--metrics".into());
    }
    if cfg.props {
        a.push("--props".into());
    }
    a.push(if cfg.slots_endpoint { "--slots" } else { "--no-slots" }.into());
    a.push(if cfg.webui { "--webui" } else { "--no-webui" }.into());
    if cfg.embedding {
        a.push("--embedding".into());
    }
    a.push(if cfg.jinja { "--jinja" } else { "--no-jinja" }.into());

    // ---- context & batching ---------------------------------------------
    a.push("-c".into());
    a.push(cfg.ctx_size.to_string());
    a.push("-n".into());
    a.push(cfg.n_predict.to_string());
    a.push("-b".into());
    a.push(cfg.batch_size.to_string());
    a.push("-ub".into());
    a.push(cfg.ubatch_size.to_string());
    if cfg.threads != -1 {
        a.push("-t".into());
        a.push(cfg.threads.to_string());
    }
    if cfg.threads_batch != -1 {
        a.push("-tb".into());
        a.push(cfg.threads_batch.to_string());
    }

    // ---- model loading / offload ----------------------------------------
    a.push("-ngl".into());
    match cfg.gpu_layers_mode.as_str() {
        "all" => a.push("all".into()),
        "custom" => a.push(cfg.gpu_layers_value.to_string()),
        _ => a.push("auto".into()),
    }
    a.push("-fa".into());
    a.push(cfg.flash_attn.clone());
    a.push("-sm".into());
    a.push(cfg.split_mode.clone());
    if !cfg.tensor_split.trim().is_empty() {
        a.push("-ts".into());
        a.push(cfg.tensor_split.trim().to_string());
    }
    a.push("-mg".into());
    a.push(cfg.main_gpu.to_string());
    if !cfg.device.trim().is_empty() {
        a.push("-dev".into());
        a.push(cfg.device.trim().to_string());
    }
    a.push(if cfg.kv_offload { "-kvo" } else { "-nkvo" }.into());
    a.push("-ctk".into());
    a.push(cfg.cache_type_k.clone());
    a.push("-ctv".into());
    a.push(cfg.cache_type_v.clone());
    a.push("-lm".into());
    a.push(cfg.load_mode.clone());
    if !cfg.numa.trim().is_empty() {
        a.push("--numa".into());
        a.push(cfg.numa.trim().to_string());
    }
    if !cfg.lora.trim().is_empty() {
        a.push("--lora".into());
        a.push(cfg.lora.trim().to_string());
    }

    // ---- rope ------------------------------------------------------------
    if cfg.rope_scaling != "none" && !cfg.rope_scaling.trim().is_empty() {
        a.push("--rope-scaling".into());
        a.push(cfg.rope_scaling.clone());
    }
    if (cfg.rope_scale - 1.0).abs() > f64::EPSILON {
        a.push("--rope-scale".into());
        a.push(format!("{:.4}", cfg.rope_scale));
    }
    if cfg.yarn_orig_ctx > 0 {
        a.push("--yarn-orig-ctx".into());
        a.push(cfg.yarn_orig_ctx.to_string());
    }

    // ---- sampling --------------------------------------------------------
    a.push("--temp".into());
    a.push(format!("{:.4}", cfg.temperature));
    a.push("--top-p".into());
    a.push(format!("{:.4}", cfg.top_p));
    a.push("--top-k".into());
    a.push(cfg.top_k.to_string());
    a.push("--min-p".into());
    a.push(format!("{:.4}", cfg.min_p));
    a.push("--repeat-penalty".into());
    a.push(format!("{:.4}", cfg.repeat_penalty));
    a.push("--repeat-last-n".into());
    a.push(cfg.repeat_last_n.to_string());
    if cfg.presence_penalty != 0.0 {
        a.push("--presence-penalty".into());
        a.push(format!("{:.4}", cfg.presence_penalty));
    }
    if cfg.frequency_penalty != 0.0 {
        a.push("--frequency-penalty".into());
        a.push(format!("{:.4}", cfg.frequency_penalty));
    }
    if cfg.seed != -1 {
        a.push("-s".into());
        a.push(cfg.seed.to_string());
    }

    // ---- multimodal ------------------------------------------------------
    if !cfg.mmproj_path.trim().is_empty() {
        a.push(if cfg.mmproj_offload {
            "--mmproj-offload"
        } else {
            "--no-mmproj-offload"
        }
        .into());
        if !cfg.mmproj_device.trim().is_empty() {
            a.push("-mmdev".into());
            a.push(cfg.mmproj_device.trim().to_string());
        }
    }

    // ---- logging ---------------------------------------------------------
    a.push("--log-colors".into());
    a.push("off".into());
    if cfg.verbosity >= 0 {
        a.push("-lv".into());
        a.push(cfg.verbosity.to_string());
    }
    a.push(if cfg.log_timestamps {
        "--log-timestamps"
    } else {
        "--no-log-timestamps"
    }
    .into());
    if !cfg.log_file.trim().is_empty() {
        a.push("--log-file".into());
        a.push(cfg.log_file.trim().to_string());
    }

    a.extend(split_extra(&cfg.extra_args));
    a
}

#[cfg(test)]
mod tests {
    use super::client_host;

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
}
