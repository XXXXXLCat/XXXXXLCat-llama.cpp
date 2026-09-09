//! 系统硬件指标采集：CPU / 内存 / GPU（NVIDIA）。
//!
//! - CPU 占用率与物理内存用量通过 `sysinfo` 获取（跨平台）。
//! - GPU 名称、利用率、显存、温度通过 `nvidia-smi` 子进程查询（CSV 输出）。
//!   `nvidia-smi` 随 NVIDIA 驱动自带，无需额外 Rust 依赖；无 NVIDIA 显卡
//!   （命令缺失或失败）时返回空列表，前端据此显示「未检测到 GPU」。

use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;

use sysinfo::System;

#[derive(Serialize, Clone, Debug, Default)]
pub struct GpuMetric {
    pub name: String,
    /// 利用率百分比 0–100
    pub utilization: Option<f32>,
    /// 已用显存（字节）
    pub memory_used: Option<u64>,
    /// 总显存（字节）
    pub memory_total: Option<u64>,
    /// 核心温度（摄氏度）
    pub temperature: Option<u32>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SystemMetrics {
    /// CPU 整体占用率百分比 0–100
    pub cpu_usage: f32,
    /// 逻辑 CPU 数（含超线程），用于展示与线程数推荐上界
    pub cpu_count: usize,
    /// 物理核心数（不含超线程）；平台无法获取时为 null
    pub cpu_physical_count: Option<usize>,
    /// 已用物理内存（字节）
    pub memory_used: u64,
    /// 总物理内存（字节）
    pub memory_total: u64,
    pub gpus: Vec<GpuMetric>,
    /// CPU 型号名（如 AMD Ryzen 9 3900X 12-Core Processor），来自 sysinfo
    pub cpu_name: String,
    /// llama.cpp 版本（来自 `<server_bin> --version`）；检测失败时为 null
    pub llama_version: Option<String>,
    /// 本软件自身版本号（取自 tauri.conf.json 的 `version`，如 0.1.2）
    pub app_version: String,
}

// 跨轮询复用同一个 System 实例：sysinfo 的 CPU 占用率依赖相邻两次刷新计算差值。
static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

/// 采集一次当前系统指标。命令失败时不抛错，返回尽可能多的有效数据。
///
/// `server_bin` / `llama_dir` 用于解析 llama.cpp 可执行文件以查询其版本号
/// （通过 `<bin> --version`）。版本检测有缓存，不会每次轮询都拉起进程。
pub fn collect(server_bin: &str, llama_dir: &str) -> SystemMetrics {
    let mut guard = SYSTEM.lock().expect("sysinfo mutex poisoned");
    let sys = guard.get_or_insert_with(System::new);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpus = sys.cpus();
    let cpu_usage = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    };
    let cpu_count = cpus.len();
    let cpu_physical_count = sys.physical_core_count();
    // sysinfo 在 Windows 下 Cpu::name() 常返回 "CPU 1" 这类占位符；
    // 取 global_cpu_info().brand() 才是真实 CPU 型号名。
    let cpu_name = cpus
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();

    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    drop(guard);

    let metrics = SystemMetrics {
        cpu_usage,
        cpu_count,
        cpu_physical_count,
        memory_used,
        memory_total,
        gpus: collect_gpus(),
        cpu_name,
        llama_version: detect_llama_version(server_bin, llama_dir),
        app_version: String::new(),
    };
    metrics
}

/// 解析 llama.cpp 可执行文件路径并返回一个存在的候选路径。
///
/// 搜索顺序：
/// 1. `server_bin` 是绝对路径且存在 → 直接使用；
/// 2. `llama_dir/server_bin` 存在 → 使用；
/// 3. `llama_dir/llama.cpp/server_bin` 存在（用户常见双层目录结构）→ 使用；
/// 4. 直接回退到 `server_bin`（依赖 PATH）。
fn resolve_existing_bin(server_bin: &str, llama_dir: &str) -> Option<String> {
    let s = server_bin.trim();
    if s.is_empty() {
        return resolve_existing_bin("llama-server.exe", llama_dir);
    }

    let p = std::path::Path::new(s);
    if p.is_absolute() && p.exists() {
        return Some(s.to_string());
    }

    let candidates = [
        std::path::Path::new(llama_dir).join(s),
        std::path::Path::new(llama_dir).join("llama.cpp").join(s),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.to_string_lossy().to_string());
        }
    }

    // 最后回退：裸文件名，交给操作系统 PATH 查找
    Some(s.to_string())
}

/// 缓存：键为已解析的可执行文件路径，值为其版本字符串（None 表示检测失败）。
/// 用 `Option` 包裹以便延迟初始化（`HashMap::new` 不是 const 函数，不能在 static 直接调用）。
static LLAMA_VERSIONS: Mutex<Option<std::collections::HashMap<String, Option<String>>>> =
    Mutex::new(None);

/// 运行 `<bin> --version` 解析 llama.cpp 版本号。结果按可执行文件路径缓存，
/// 避免每 2 秒指标轮询都拉起一次进程。
fn detect_llama_version(server_bin: &str, llama_dir: &str) -> Option<String> {
    let Some(bin) = resolve_existing_bin(server_bin, llama_dir) else {
        return None;
    };

    let mut guard = LLAMA_VERSIONS.lock().unwrap();
    let cache = guard.get_or_insert_with(std::collections::HashMap::new);

    // 命中缓存直接返回
    if let Some(cached) = cache.get(&bin) {
        return cached.clone();
    }

    let output = {
        let mut cmd = Command::new(&bin);
        cmd.arg("--version");
        // 同 collect_gpus：llama-server 是控制台子系统程序，GUI 父进程派生它时
        // Windows 会新建一个可见控制台窗口。不加此标志表现为「打开 exe 后
        // 闪过一个 cmd 窗口随即消失」（版本检测在启动后首次指标轮询时触发）。
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.output()
    };
    let version = output.ok().and_then(|o| {
        // llama-server --version 输出到 stdout；保险起见 stdout + stderr 合并查找
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&o.stdout),
            String::from_utf8_lossy(&o.stderr)
        );
        text.lines()
            .find_map(|l| l.trim().strip_prefix("version:"))
            .map(|v| v.trim().to_string())
    });

    if version.is_none() {
        log::warn!(
            "无法从 {} 解析 llama.cpp 版本（server_bin={}, llama_dir={}）",
            bin,
            server_bin,
            llama_dir
        );
    }

    cache.insert(bin, version.clone());
    version
}


/// 通过 `nvidia-smi` 查询每块 GPU 的指标。无 NVIDIA 时返回空列表。
fn collect_gpus() -> Vec<GpuMetric> {
    const QUERY: &str =
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu";
    const FORMAT: &str = "--format=csv,noheader,nounits";

    // 优先 PATH，其次 NVIDIA 驱动默认安装目录。
    let candidates = [
        "nvidia-smi".to_string(),
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe".to_string(),
    ];

    let Some(output) = candidates.iter().find_map(|bin| {
        let mut cmd = Command::new(bin);
        cmd.args([QUERY, FORMAT]);
        // Windows 下 nvidia-smi 是控制台子系统程序，而父进程（Tauri 桌面应用）
        // 是 GUI 子系统。GUI 程序派生命令行子进程时，Windows 会为其新建一个
        // 可见控制台窗口，导致每 2 秒（指标轮询周期）弹出一个 cmd 窗口。
        // 设置 CREATE_NO_WINDOW (0x08000000) 抑制子进程控制台窗口。
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.output()
            .ok()
            .filter(|o| o.status.success())
    }) else {
        return Vec::new();
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut gpus = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if parts.len() < 5 {
            continue;
        }
        let parse_f = |s: &str| s.parse::<f32>().ok();
        let parse_u = |s: &str| s.parse::<u64>().ok();

        // nvidia-smi 显存单位为 MiB，换算为字节以便前端统一用 format_bytes。
        let mib_to_bytes = |mib: u64| mib * 1024 * 1024;

        gpus.push(GpuMetric {
            name: parts[0].to_string(),
            utilization: parse_f(parts[1]),
            memory_used: parse_u(parts[2]).map(mib_to_bytes),
            memory_total: parse_u(parts[3]).map(mib_to_bytes),
            temperature: parse_u(parts[4]).map(|c| c as u32),
        });
    }
    gpus
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_struct_is_serializable() {
        // 单纯确保结构可被 serde 序列化（命令返回给前端）。
        let m = SystemMetrics {
            cpu_usage: 12.5,
            cpu_count: 24,
            cpu_physical_count: Some(12),
            memory_used: 4_000_000_000,
            memory_total: 16_000_000_000,
            gpus: vec![GpuMetric {
                name: "NVIDIA GeForce RTX 4090".into(),
                utilization: Some(50.0),
                memory_used: Some(2_000_000_000),
                memory_total: Some(24_000_000_000),
                temperature: Some(60),
            }],
            cpu_name: "AMD Ryzen 9 3900X 12-Core Processor".into(),
            llama_version: Some("0.4.0-dev (build 10819, commit 6a1a922d2)".into()),
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("RTX 4090"));
        assert!(json.contains("cpu_usage"));
    }
}
