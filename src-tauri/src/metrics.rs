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
    /// 已用物理内存（字节）
    pub memory_used: u64,
    /// 总物理内存（字节）
    pub memory_total: u64,
    pub gpus: Vec<GpuMetric>,
}

// 跨轮询复用同一个 System 实例：sysinfo 的 CPU 占用率依赖相邻两次刷新计算差值。
static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

/// 采集一次当前系统指标。命令失败时不抛错，返回尽可能多的有效数据。
pub fn collect() -> SystemMetrics {
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

    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    drop(guard);

    let metrics = SystemMetrics {
        cpu_usage,
        memory_used,
        memory_total,
        gpus: collect_gpus(),
    };
    metrics
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
            memory_used: 4_000_000_000,
            memory_total: 16_000_000_000,
            gpus: vec![GpuMetric {
                name: "NVIDIA GeForce RTX 4090".into(),
                utilization: Some(50.0),
                memory_used: Some(2_000_000_000),
                memory_total: Some(24_000_000_000),
                temperature: Some(60),
            }],
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("RTX 4090"));
        assert!(json.contains("cpu_usage"));
    }
}
