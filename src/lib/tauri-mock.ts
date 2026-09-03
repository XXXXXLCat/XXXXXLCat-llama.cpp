/**
 * common.browse器预览支撑层（仅当运行在纯 Web 环境时common.enabled）。
 *
 * Tauri 桌面运行时内，所有命令由 Rust 后端执行；本模块在无 Tauri 的common.browse器中
 * 提供行为一致的模拟实现（配置读写 / nav.models扫描 / mmproj 匹配 / 服务启动logs.title流），
 * 使 `vite dev` 可独立预览 UI 全流程。数据仅存于 localStorage，不触碰磁盘。
 */
import type {
  AppSettings,
  GpuMetric,
  LaunchConfig,
  LogLine,
  MmprojMatch,
  ModelFile,
  ServerStatus,
  SystemMetrics,
} from './tauri-api'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * settings.listenAddr → 本机可连接地址（镜像 Rust `server::client_host` 与
 * `tauri-api.clientHost`）。此处本地实现而非从 tauri-api 导入，是为避免
 * 与该模块形成运行时循环依赖（tauri-api 需要本模块的 createMock）。
 */
function mockClientHost(host: string): string {
  const h = host.trim()
  return h === '' || h === '0.0.0.0' || h === '::' || h === '[::]' ? '127.0.0.1' : h
}

const LS_KEY = 'llama-launcher.mock.v1'

// ------------------------------------------------------------- 真实nav.models快照
// 与用户本机 D:\llama.cpp\model 下的三组nav.models一致，用于预览时的列表与匹配效果。
const MODEL_ENTRIES: Array<{
  text: { name: string; sizeBytes: number }
  mmproj: { name: string; sizeBytes: number }
  dir: string
  family: string
  quant: string
}> = [
  {
    dir: 'HauhauCS\\Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive',
    family: 'Qwen3.6-35B-A3B',
    quant: 'Q4_K_M',
    text: {
      name: 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
      sizeBytes: 21166758016,
    },
    mmproj: {
      name: 'mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf',
      sizeBytes: 899283072,
    },
  },
  {
    dir: 'unsloth\\Qwen3.8-27B-GGUF',
    family: 'Qwen3.8-27B',
    quant: 'Q4_K_M',
    text: { name: 'Qwen3.8-27B-Q4_K_M.gguf', sizeBytes: 17106773984 },
    mmproj: { name: 'mmproj-F16.gguf', sizeBytes: 927607488 },
  },
  {
    dir: 'unsloth\\gemma-4-31B-it-GGUF',
    family: 'gemma-4-31B-it',
    quant: 'Q4_K_XL',
    text: { name: 'gemma-4-31B-it-UD-Q4_K_XL.gguf', sizeBytes: 18822970304 },
    mmproj: { name: 'mmproj-BF16.gguf', sizeBytes: 1200726496 },
  },
]

const MODEL_ROOT = 'D:\\llama.cpp\\model'

function buildModelFiles(): ModelFile[] {
  const out: ModelFile[] = []
  for (const e of MODEL_ENTRIES) {
    out.push({
      path: `${MODEL_ROOT}\\${e.dir}\\${e.text.name}`,
      name: e.text.name,
      dir: e.dir,
      sizeBytes: e.text.sizeBytes,
      kind: 'text',
      family: e.family,
      quant: e.quant,
      params: e.family.includes('35B') ? '35B-A3B' : e.family.includes('27B') ? '27B' : '31B',
    })
    out.push({
      path: `${MODEL_ROOT}\\${e.dir}\\${e.mmproj.name}`,
      name: e.mmproj.name,
      dir: e.dir,
      sizeBytes: e.mmproj.sizeBytes,
      kind: 'vision',
      family: e.family,
      quant: null,
      params: null,
    })
  }
  return out
}

// ------------------------------------------------------------- 默认配置
// 与 Rust `LaunchConfig::default()` 保持一致；仅 modelPath 预设为本机真实nav.models，
// 便于common.browse器预览立即展示完整效果。
export const DEFAULT_CONFIG: LaunchConfig = {
  llamaDir: 'D:\\llama.cpp\\llama.cpp',
  serverBin: 'llama-server.exe',
  modelRoot: MODEL_ROOT,
  modelPath:
    'D:\\llama.cpp\\model\\unsloth\\Qwen3.8-27B-GGUF\\Qwen3.8-27B-Q4_K_M.gguf',
  mmprojPath: '',
  autoMmproj: true,

  host: '127.0.0.1',
  port: 8080,
  parallel: -1,
  contBatching: true,
  timeout: 3600,
  threadsHttp: -1,
  alias: '',
  apiKey: '',
  metrics: false,
  props: false,
  slotsEndpoint: true,
  webui: true,
  embedding: false,
  jinja: true,

  ctxSize: 8192,
  nPredict: -1,
  batchSize: 2048,
  ubatchSize: 512,
  threads: -1,
  threadsBatch: -1,
  gpuLayersMode: 'auto',
  gpuLayersValue: 999,
  flashAttn: 'auto',
  splitMode: 'layer',
  tensorSplit: '',
  mainGpu: 0,
  device: '',
  kvOffload: true,
  cacheTypeK: 'f16',
  cacheTypeV: 'f16',
  loadMode: 'auto',
  numa: '',
  lora: '',

  ropeScaling: 'none',
  ropeScale: 1,
  yarnOrigCtx: 0,

  temperature: 0.8,
  topP: 0.95,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1,
  repeatLastN: 64,
  presencePenalty: 0,
  frequencyPenalty: 0,
  seed: -1,

  mmprojOffload: true,
  mmprojDevice: '',

  verbosity: 3,
  logTimestamps: true,
  logFile: '',

  extraArgs: '',
  killOnExit: true,
  autoOpenBrowser: false,
}

// ---------------------------------------------------------------- 内部状态

export interface MockApi {
  getSettings(): Promise<AppSettings>
  saveSettings(s: AppSettings): Promise<void>
  scanModelDir(root: string): Promise<ModelFile[]>
  resolveMmproj(modelPath: string, root: string): Promise<MmprojMatch>
  startServer(config: LaunchConfig): Promise<void>
  stopServer(): Promise<void>
  getStatus(): Promise<ServerStatus>
  getLogs(): Promise<LogLine[]>
  clearLogs(): Promise<void>
  previewCommand(config: LaunchConfig): Promise<string[]>
  probeEndpoint(host: string, port: number): Promise<boolean>
  pickDirectory(start?: string): Promise<string | null>
  pickFile(start?: string, filters?: string[]): Promise<string | null>
  openInShell(target: string): Promise<void>
  revealInExplorer(path: string): Promise<void>
  getSystemMetrics(): Promise<SystemMetrics>
}

export interface MockModule {
  api: MockApi
  onLog(cb: (line: LogLine) => void): Promise<() => void>
  onStatus(cb: (status: ServerStatus) => void): Promise<() => void>
}

export function createMock(): MockModule {
  let settings: AppSettings = load()
  let logSeq = 1
  let status: ServerStatus = {
    running: false,
    pid: null,
    startedAt: null,
    exitCode: null,
    lastError: null,
    modelPath: null,
    mmprojPath: null,
    endpoint: null,
  }
  let logs: LogLine[] = []
  let listening = false
  const timers: number[] = []
  const logListeners = new Set<(line: LogLine) => void>()
  const statusListeners = new Set<(s: ServerStatus) => void>()

  function load(): AppSettings {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as AppSettings
        return {
          config: { ...DEFAULT_CONFIG, ...parsed.config },
          lastModelRoot: parsed.lastModelRoot || MODEL_ROOT,
        }
      }
    } catch {
      // ignore corrupted storage
    }
    return { config: { ...DEFAULT_CONFIG }, lastModelRoot: MODEL_ROOT }
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings))
    } catch {
      // storage may be unavailable (private mode etc.)
    }
  }

  function emitLog(text: string, stream: 'stdout' | 'stderr' | 'system') {
    const line: LogLine = { id: logSeq++, ts: Date.now(), stream, text }
    logs = logs.concat(line)
    if (logs.length > 5000) logs = logs.slice(logs.length - 5000)
    logListeners.forEach((cb) => cb(line))
  }

  function emitStatus(next: ServerStatus) {
    status = next
    statusListeners.forEach((cb) => cb(status))
  }

  function clearTimers() {
    while (timers.length) {
      const t = timers.pop()
      if (t !== undefined) window.clearTimeout(t)
    }
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, ms)
      timers.push(t)
    })

  // ---------------------------------------------------------------- 模拟启动
  async function runServer(config: LaunchConfig) {
    if (status.running) return
    clearTimers()
    listening = false
    const modelPath = config.modelPath || ''
    const mmprojPath = config.mmprojPath || ''
    const modelName = modelPath.split(/[\\/]/).pop() || modelPath
    const mmprojName = mmprojPath.split(/[\\/]/).pop() || null
    const endpoint = `http://${mockClientHost(config.host)}:${config.port}`

    emitLog('[模拟] 预览模式：以下为common.browse器模拟输出，真实运行请使用 Tauri 桌面版', 'system')
    emitLog(`llama-server.exe --model ${modelPath}`, 'stdout')
    if (mmprojPath) emitLog(`mmproj = ${mmprojPath}`, 'stdout')

    emitStatus({
      running: true,
      pid: 8246,
      startedAt: Date.now(),
      exitCode: null,
      lastError: null,
      modelPath,
      mmprojPath,
      endpoint,
    })

    const bootLines = [
      `llama_model_loader: loaded meta data with ${31 + (modelName.length % 9)} key-value pairs`,
      'llama_model_loader: Dumping metadata keys/values...',
      `llama_model_load: loading model '${modelName}'`,
      'llama_model_load: using CUDA device 0, name NVIDIA GeForce RTX 4090, compute capability 9.0',
      'llm_load_tensors: offloading 30 repeating layers to GPU',
      'llm_load_tensors: offloaded 30/33 layers to GPU',
      'llama_kv_cache_init: CUDA0 KV buffer size = 1024.00 MiB',
      `llama_new_context_with_model: n_ctx = ${config.ctxSize}`,
      'llama_new_context_with_model: compute buffer total size = 207.3 MiB',
      'llama_new_context_with_model: CUDA_Host output buffer size = 0.20 MiB',
      'main: server is listening on ' + endpoint,
    ]
    for (const line of bootLines) {
      await sleep(140)
      emitLog(line, 'stdout')
    }
    if (mmprojName) {
      emitLog(`clip_model_load: loading CLIP model '${mmprojName}'`, 'stdout')
      emitLog('clip_model_load: CLIP has 328 layers, total size 879.5 MiB', 'stdout')
    }
    await sleep(120)
    emitLog(`server: HTTP server listening on ${endpoint}`, 'stdout')
    emitLog(`log.launcherTag 服务已就绪，可用common.browse器访问 ${endpoint}`, 'system')
    listening = true
  }

  async function shutdownServer() {
    clearTimers()
    listening = false
    if (status.running) {
      emitLog('log.launcherTag 正在console.stopServer...', 'system')
    }
    emitStatus({
      running: false,
      pid: null,
      startedAt: null,
      exitCode: 0,
      lastError: null,
      modelPath: null,
      mmprojPath: null,
      endpoint: null,
    })
    if (status.running) {
      emitLog('log.launcherTag 服务已停止', 'system')
    }
  }

  function buildPreviewCommand(config: LaunchConfig): string[] {
    const args = [config.serverBin || 'llama-server.exe', '--model', config.modelPath]
    if (config.mmprojPath) args.push('--mmproj', config.mmprojPath)
    args.push('--host', config.host, '--port', String(config.port))
    return args
  }

  const api: MockApi = {
    async getSettings() {
      return settings
    },
    async saveSettings(s) {
      settings = { config: s.config, lastModelRoot: s.lastModelRoot || MODEL_ROOT }
      persist()
    },
    async scanModelDir(_root) {
      await sleep(450)
      return buildModelFiles()
    },
    async resolveMmproj(modelPath, _root) {
      await sleep(180)
      const files = buildModelFiles()
      const text = files.find((m) => m.kind === 'text' && m.path === modelPath)
      if (!text) {
        return { mmprojPath: null, confidence: 'none', score: 0, candidates: [] }
      }
      const candidates = files
        .filter((m) => m.kind === 'vision' && m.dir === text.dir)
        .map((m) => m.path)
      return {
        mmprojPath: candidates[0] ?? null,
        confidence: candidates.length ? 'exact' : 'none',
        score: candidates.length ? 1 : 0,
        candidates,
      }
    },
    async startServer(cfg) {
      await runServer(cfg)
    },
    async stopServer() {
      await shutdownServer()
    },
    async getStatus() {
      return status
    },
    async getLogs() {
      return logs
    },
    async clearLogs() {
      logs = []
    },
    async previewCommand(cfg) {
      return buildPreviewCommand(cfg)
    },
    async probeEndpoint(_host, _port) {
      return listening && status.running
    },
    async pickDirectory(_start) {
      return null
    },
    async pickFile(_start, _filters) {
      return null
    },
    async openInShell(target) {
      console.info('[mock] open in shell:', target)
    },
    async revealInExplorer(path) {
      console.info('[mock] reveal in explorer:', path)
    },
    async getSystemMetrics() {
      await sleep(80)
      // common.browse器预览无真实硬件，返回带轻微抖动的拟真数据，便于查看 UI 形态。
      const t = Date.now() / 1000
      const wobble = (base: number, amp: number) =>
        Math.max(0, Math.min(100, base + Math.sin(t / 3) * amp))
      const gpu: GpuMetric = {
        name: 'NVIDIA GeForce RTX 4090 (模拟)',
        utilization: wobble(38, 18),
        memory_used: 11_500_000_000 + Math.round(Math.sin(t / 5) * 1_500_000_000),
        memory_total: 24_000_000_000,
        temperature: Math.round(wobble(62, 6)),
      }
      return {
        cpu_usage: wobble(22, 12),
        memory_used: 9_400_000_000 + Math.round(Math.sin(t / 7) * 800_000_000),
        memory_total: 32_000_000_000,
        gpus: [gpu],
      }
    },
  }

  return {
    api,
    async onLog(cb) {
      logListeners.add(cb)
      return () => logListeners.delete(cb)
    },
    async onStatus(cb) {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
  }
}
