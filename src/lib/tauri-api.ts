import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createMock, isTauriRuntime, type MockModule } from './tauri-mock'

// ------------------------------------------------------------------- types

export type ModelKind = 'text' | 'vision'

export interface ModelFile {
  path: string
  name: string
  dir: string
  sizeBytes: number
  kind: ModelKind
  family: string | null
  quant: string | null
  params: string | null
}

export type MatchConfidence = 'exact' | 'unique' | 'weak' | 'none'

export interface MmprojMatch {
  mmprojPath: string | null
  confidence: MatchConfidence
  score: number
  candidates: string[]
}

export interface LogLine {
  id: number
  ts: number
  stream: string
  text: string
}

export interface ServerStatus {
  running: boolean
  pid: number | null
  startedAt: number | null
  exitCode: number | null
  lastError: string | null
  modelPath: string | null
  mmprojPath: string | null
  endpoint: string | null
}

export interface LaunchConfig {
  // paths
  llamaDir: string
  serverBin: string
  modelRoot: string
  modelPath: string
  mmprojPath: string
  autoMmproj: boolean
  // server
  host: string
  port: number
  parallel: number
  contBatching: boolean
  timeout: number
  threadsHttp: number
  alias: string
  apiKey: string
  metrics: boolean
  props: boolean
  slotsEndpoint: boolean
  webui: boolean
  embedding: boolean
  jinja: boolean
  // model & memory
  ctxSize: number
  nPredict: number
  batchSize: number
  ubatchSize: number
  threads: number
  threadsBatch: number
  gpuLayersMode: string
  gpuLayersValue: number
  flashAttn: string
  splitMode: string
  tensorSplit: string
  mainGpu: number
  device: string
  kvOffload: boolean
  cacheTypeK: string
  cacheTypeV: string
  loadMode: string
  numa: string
  lora: string
  // rope
  ropeScaling: string
  ropeScale: number
  yarnOrigCtx: number
  // sampling
  temperature: number
  topP: number
  topK: number
  minP: number
  repeatPenalty: number
  repeatLastN: number
  presencePenalty: number
  frequencyPenalty: number
  seed: number
  // multimodal
  mmprojOffload: boolean
  mmprojDevice: string
  // logging
  verbosity: number
  logTimestamps: boolean
  logFile: string
  // misc
  extraArgs: string
  killOnExit: boolean
  autoOpenBrowser: boolean
}

export interface AppSettings {
  config: LaunchConfig
  lastModelRoot: string
}

// ----------------------------------------------------------------- metrics

export interface GpuMetric {
  /** 显卡名称（如 NVIDIA GeForce RTX 4090） */
  name: string
  /** 利用率百分比 0–100 */
  utilization: number | null
  /** 已用显存（字节） */
  memory_used: number | null
  /** 总显存（字节） */
  memory_total: number | null
  /** 核心温度（摄氏度） */
  temperature: number | null
}

export interface SystemMetrics {
  /** CPU 整体占用率百分比 0–100 */
  cpu_usage: number
  /** 已用物理内存（字节） */
  memory_used: number
  /** 总物理内存（字节） */
  memory_total: number
  /** 各 GPU 指标；无 NVIDIA 显卡时为空数组 */
  gpus: GpuMetric[]
}

export const EVENT_LOG = 'llama://log'
export const EVENT_STATUS = 'llama://status'

// ------------------------------------------------------------------ invoke
//
// 桌面运行时内所有命令由 Rust 后端执行；在纯浏览器（`vite dev` 预览）中，
// 自动切换到 `tauri-mock` 提供的模拟实现，保证 UI 全流程可独立预览。

export interface Api {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  scanModelDir(root: string): Promise<ModelFile[]>
  resolveMmproj(modelPath: string, root: string): Promise<MmprojMatch>
  startServer(config: LaunchConfig): Promise<void>
  stopServer(): Promise<void>
  getStatus(): Promise<ServerStatus>
  getLogs(): Promise<LogLine[]>
  clearLogs(): Promise<void>
  previewCommand(config: LaunchConfig): Promise<string[]>
  probeEndpoint(host: string, port: number): Promise<boolean>
  pickDirectory(start?: string | null): Promise<string | null>
  pickFile(start?: string | null, filters?: string[] | null): Promise<string | null>
  openInShell(target: string): Promise<void>
  revealInExplorer(path: string): Promise<void>
  getSystemMetrics(): Promise<SystemMetrics>
}

const realApi: Api = {
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: AppSettings) =>
    invoke<void>('save_settings', { settingsInput: settings }),
  scanModelDir: (root: string) => invoke<ModelFile[]>('scan_model_dir', { root }),
  resolveMmproj: (modelPath: string, root: string) =>
    invoke<MmprojMatch>('resolve_mmproj', { modelPath, root }),
  startServer: (config: LaunchConfig) =>
    invoke<void>('start_server', { config }),
  stopServer: () => invoke<void>('stop_server'),
  getStatus: () => invoke<ServerStatus>('get_status'),
  getLogs: () => invoke<LogLine[]>('get_logs'),
  clearLogs: () => invoke<void>('clear_logs'),
  previewCommand: (config: LaunchConfig) =>
    invoke<string[]>('preview_command', { config }),
  probeEndpoint: (host: string, port: number) =>
    invoke<boolean>('probe_endpoint', { host, port }),
  pickDirectory: (start?: string | null) =>
    invoke<string | null>('pick_directory', { start: start ?? null }),
  pickFile: (start?: string | null, filters?: string[] | null) =>
    invoke<string | null>('pick_file', { start: start ?? null, filters: filters ?? null }),
  openInShell: (target: string) => invoke<void>('open_in_shell', { target }),
  revealInExplorer: (path: string) => invoke<void>('reveal_in_explorer', { path }),
  getSystemMetrics: () => invoke<SystemMetrics>('get_system_metrics'),
}

let mockModule: MockModule | null = null
function getMock(): MockModule {
  if (!mockModule) mockModule = createMock()
  return mockModule
}

/** 环境自适应代理：Tauri 内走 Rust，浏览器内走模拟层。 */
export const api: Api = new Proxy({} as Api, {
  get(_target, prop: string | symbol) {
    const impl: Api = isTauriRuntime() ? realApi : getMock().api
    const fn = Reflect.get(impl, prop)
    return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown).bind(impl) : fn
  },
})

export function onLog(cb: (line: LogLine) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen<LogLine>(EVENT_LOG, (e) => cb(e.payload))
  return getMock().onLog(cb)
}

export function onStatus(cb: (status: ServerStatus) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen<ServerStatus>(EVENT_STATUS, (e) => cb(e.payload))
  return getMock().onStatus(cb)
}

// ----------------------------------------------------------------- helpers

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * 把「监听地址」换算为本机客户端能真正连上的地址。
 *
 * `0.0.0.0` / `::` 只是通配绑定地址：Windows 拒绝向其发起连接
 * （WinError 10049），浏览器也无法加载 `http://0.0.0.0:8080`。
 * 与 Rust 侧 `server::client_host` 保持同一语义。
 */
export function clientHost(host: string): string {
  const h = host.trim()
  return h === '' || h === '0.0.0.0' || h === '::' || h === '[::]' ? '127.0.0.1' : h
}

/** 供浏览器打开的服务地址（监听地址已归一化）。 */
export function endpointUrl(host: string, port: number): string {
  return `http://${clientHost(host)}:${port}`
}

export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

export function dirNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts.slice(0, -1).join('\\')
}
