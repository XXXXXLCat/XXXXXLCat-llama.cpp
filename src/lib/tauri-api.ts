import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createMock, DEFAULT_CONFIG, isTauriRuntime, type MockModule } from './tauri-mock'

// ------------------------------------------------------------------- types

export type ModelKind = 'text' | 'vision' | 'draft'

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

export interface DraftMatch {
  draftPath: string | null
  confidence: MatchConfidence
  score: number
  candidates: string[]
}

/** Metadata read from a GGUF header (see Rust `gguf::parse_gguf`). */
export interface ModelMeta {
  architecture: string | null
  name: string | null
  author: string | null
  basename: string | null
  finetune: string | null
  description: string | null
  license: string | null
  tags: string[] | null
  languages: string[] | null
  domain: string | null
  formatVersion: number | null
  fileVersion: number | null
  quantizationVersion: number | null
  tensorDataLayout: string | null
  paramCount: number | null
  contextLength: number | null
  sizeLabel: string | null
  quant: string | null
  fileType: number | null
  vocabSize: number | null
  embeddingLength: number | null
  blockCount: number | null
  chatTemplate: string | null
  headCount: number | null
  headCountKv: number | null
  keyLength: number | null
  valueLength: number | null
  normEpsilon: number | null
  causal: boolean | null
  ropeFreqBase: number | null
  ropeDim: number | null
  ropeScaleLinear: number | null
  ropeScalingType: string | null
  slidingWindow: number | null
  poolingType: string | null
  expertCount: number | null
  expertUsedCount: number | null
  bosTokenId: number | null
  eosTokenId: number | null
  tokenizerModel: string | null
  tokenizerPre: string | null
  addBos: boolean | null
  addEos: boolean | null
  /** Verbatim remainder of the GGUF KV block (excludes giant tokenizer arrays). */
  extra: Record<string, string>
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
  // speculative decoding (MTP / draft)
  draftModelPath: string
  autoDraft: boolean
  // server
  //
  // 约定：`null` 表示「未设置」，启动时不下发该参数，由 llama-server 使用自身
  // 默认值；设置页对应输入框留空并以灰色占位提示默认值。
  host: string
  port: number
  parallel: number | null
  contBatching: boolean | null
  timeout: number | null
  threadsHttp: number | null
  alias: string
  apiKey: string
  metrics: boolean | null
  props: boolean | null
  slotsEndpoint: boolean | null
  webui: boolean | null
  embedding: boolean | null
  jinja: boolean | null
  // model & memory
  ctxSize: number | null
  batchSize: number | null
  ubatchSize: number | null
  threads: number | null
  threadsBatch: number | null
  /** GPU 卸载是核心能力，始终下发，不使用 null */
  gpuLayersMode: string
  gpuLayersValue: number
  flashAttn: string | null
  splitMode: string | null
  tensorSplit: string
  mainGpu: number | null
  device: string
  kvOffload: boolean | null
  cacheTypeK: string | null
  cacheTypeV: string | null
  loadMode: string | null
  numa: string
  lora: string
  // model loading extras
  cachePrompt: boolean | null
  cacheReuse: number | null
  cpuMoe: boolean | null
  nCpuMoe: number | null
  nCpuFfn: number | null
  imageMinTokens: number | null
  imageMaxTokens: number | null
  // rope
  ropeScaling: string
  ropeScale: number | null
  yarnOrigCtx: number | null
  // rope extras
  yarnExtFactor: number | null
  yarnAttnFactor: number | null
  yarnBetaSlow: number | null
  yarnBetaFast: number | null
  // multimodal
  mmprojOffload: boolean | null
  mmprojDevice: string
  // logging
  verbosity: number | null
  logTimestamps: boolean | null
  logFile: string
  logColors: string
  logPrefix: boolean | null
  // memory & capacity fitting
  fit: string | null
  fitTarget: string
  fitCtx: number | null
  cacheRam: number | null
  kvUnified: boolean | null
  kvUnifiedPerSlot: number | null
  cacheIdleSlots: boolean | null
  swaFull: boolean | null
  keep: number | null
  contextShift: boolean | null
  ctxCheckpoints: number | null
  checkpointMinStep: number | null
  // sampling (server-side defaults)
  predict: number | null
  samplers: string
  samplerSeq: string
  seed: number | null
  ignoreEos: boolean | null
  temp: number | null
  topK: number | null
  topP: number | null
  minP: number | null
  topNsigma: number | null
  xtcProbability: number | null
  xtcThreshold: number | null
  typicalP: number | null
  repeatLastN: number | null
  repeatPenalty: number | null
  presencePenalty: number | null
  frequencyPenalty: number | null
  dryMultiplier: number | null
  dryBase: number | null
  dryAllowedLength: number | null
  dryPenaltyLastN: number | null
  drySequenceBreaker: string
  adaptiveTarget: number | null
  adaptiveDecay: number | null
  dynatempRange: number | null
  dynatempExp: number | null
  mirostat: number | null
  mirostatLr: number | null
  mirostatEnt: number | null
  logitBias: string
  grammar: string
  grammarFile: string
  jsonSchema: string
  jsonSchemaFile: string
  backendSampling: boolean | null
  // model loading & tensor control
  overrideTensor: string
  repack: boolean | null
  noHost: boolean | null
  lazyMode: string | null
  directIo: boolean | null
  mlock: boolean | null
  mmap: boolean | null
  checkTensors: boolean | null
  overrideKv: string
  opOffload: boolean | null
  rpc: string
  cpuMask: string
  cpuRange: string
  cpuStrict: number | null
  prio: number | null
  poll: number | null
  // speculative decoding
  specType: string
  specDraftNMax: number | null
  specDraftNMin: number | null
  specDraftPSplit: number | null
  specDraftPMin: number | null
  specDraftNgl: string
  specDraftDevice: string
  specDraftCpuMoe: boolean | null
  specDraftNCpuMoe: number | null
  specDraftThreads: number | null
  specNgramModNMin: number | null
  specNgramModNMax: number | null
  specNgramModNMatch: number | null
  specNgramSimpleSizeN: number | null
  specNgramSimpleSizeM: number | null
  specNgramSimpleMinHits: number | null
  specNgramMapKSizeN: number | null
  specNgramMapKSizeM: number | null
  specNgramMapKMinHits: number | null
  specNgramMapK4vSizeN: number | null
  specNgramMapK4vSizeM: number | null
  specNgramMapK4vMinHits: number | null
  // networking, security & endpoints
  reusePort: boolean | null
  apiPrefix: string
  staticPath: string
  corsOrigins: string
  corsMethods: string
  corsHeaders: string
  corsCredentials: boolean | null
  sslKeyFile: string
  sslCertFile: string
  apiKeyFile: string
  ssePingInterval: number | null
  mediaPath: string
  slotSavePath: string
  modelsDir: string
  modelsPreset: string
  modelsMax: number | null
  modelsAutoload: boolean | null
  rerank: boolean | null
  sleepIdleSeconds: number | null
  logPromptsDir: string
  // inference behaviour & templates
  chatTemplate: string
  chatTemplateFile: string
  chatTemplateKwargs: string
  reasoningFormat: string
  reasoning: string | null
  reasoningEffort: string
  reasoningBudget: number | null
  reasoningPreserve: boolean | null
  skipChatParsing: boolean | null
  prefillAssistant: boolean | null
  pooling: string
  embdNormalize: number | null
  slotPromptSimilarity: number | null
  warmup: boolean | null
  lookupCacheStatic: string
  lookupCacheDynamic: string
  loraScaled: string
  loraInitWithoutApply: boolean | null
  controlVector: string
  controlVectorScaled: string
  controlVectorLayerRange: string
  spmInfill: boolean | null
  special: boolean | null
  offline: boolean | null
  // multimodal & video
  mmprojAuto: boolean | null
  mmprojUrl: string
  mtmdBatchMaxTokens: number | null
  videoFps: number | null
  videoTimestampInterval: number | null
  videoFfmpegDir: string
  tags: string
  // batch / CPU affinity (batch variants)
  cpuMaskBatch: string
  cpuRangeBatch: string
  cpuStrictBatch: number | null
  prioBatch: number | null
  pollBatch: number | null
  // rope freq (NTK-aware)
  ropeFreqBase: number | null
  ropeFreqScale: number | null
  // speculative decoding: draft KV cache types
  specDraftTypeK: string | null
  specDraftTypeV: string | null
  // speculative decoding: draft CPU / perf
  specDraftThreadsBatch: number | null
  specDraftCpuMask: string
  specDraftCpuRange: string
  specDraftCpuStrict: number | null
  specDraftPrio: number | null
  specDraftPoll: number | null
  specDraftCpuMaskBatch: string
  specDraftCpuStrictBatch: number | null
  specDraftPrioBatch: number | null
  specDraftPollBatch: number | null
  specDraftOverrideTensor: string
  specDraftBackendSampling: boolean | null
  // logging extras
  logDisable: boolean | null
  perf: boolean | null
  // inference behaviour
  reversePrompt: string
  escape: boolean | null
  // WebUI / agent / tools
  uiConfig: string
  uiConfigFile: string
  uiMcpProxy: boolean | null
  tools: string
  toolsRuntime: string
  mcpServersConfig: string
  mcpServersJson: string
  agent: boolean | null
  // reasoning extras
  reasoningBudgetMessage: string
  // misc
  extraArgs: string
  killOnExit: boolean
  autoOpenBrowser: boolean
  /** 服务就绪后自动跳转到软件内的 WebUI 页。 */
  autoGotoWebui: boolean
  /** 启动服务前终止上次遗留的服务进程，释放其占用的显存。 */
  cleanVramOnStart: boolean
  /** 用户显式修改过的参数键（camelCase）。自动推荐时跳过这些键，避免覆盖手动设置。 */
  manualParams: string[]
}

export interface AppSettings {
  config: LaunchConfig
  lastModelRoot: string
  /** 多个模型根目录（扫描时合并）；首项为当前主目录。 */
  modelLibraries: string[]
  /** 用户保存的启动配置快照。 */
  profiles: ModelProfile[]
}

export interface ModelProfile {
  name: string
  modelPath: string
  mmprojPath: string
  draftModelPath: string
  ctxSize: number | null
  gpuLayersMode: string
  gpuLayersValue: number
  flashAttn: string | null
}

// ----------------------------------------------------------------- metrics

export interface GpuMetric {
  /** 显卡名称（如 NVIDIA GeForce RTX 4090） */
  name: string
  /** 利用率百分比 0–100 */
  utilization: number | null
  /** 已用console.vram（字节） */
  memory_used: number | null
  /** 总console.vram（字节） */
  memory_total: number | null
  /** 核心settings.tempLabel（摄氏度） */
  temperature: number | null
}

export interface SystemMetrics {
  /** CPU 整体占用率百分比 0–100 */
  cpu_usage: number
  /** 逻辑 CPU 数（含超线程） */
  cpu_count: number
  /** 物理核心数；平台无法获取时为 null */
  cpu_physical_count: number | null
  /** 已用物理console.memory（字节） */
  memory_used: number
  /** 总物理console.memory（字节） */
  memory_total: number
  /** 各 GPU 指标；无 NVIDIA 显卡时为空数组 */
  gpus: GpuMetric[]
  /** CPU 型号名（如 AMD Ryzen 9 3900X 12-Core Processor） */
  cpu_name: string
  /** llama.cpp 版本（来自 `<server_bin> --version`）；检测失败时为 null */
  llama_version: string | null
  /** 本软件自身版本号（取自 tauri.conf.json 的 version） */
  app_version: string
}

export const EVENT_LOG = 'llama://log'
export const EVENT_STATUS = 'llama://status'

// ------------------------------------------------------------------ invoke
//
// 桌面运行时内所有命令由 Rust 后端执行；在纯common.browse器（`vite dev` 预览）中，
// 自动切换到 `tauri-mock` 提供的模拟实现，保证 UI 全流程可独立预览。

export interface Api {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  scanModelDirs(roots: string[]): Promise<ModelFile[]>
  resolveMmproj(modelPath: string, root: string): Promise<MmprojMatch>
  resolveDraft(modelPath: string, root: string): Promise<DraftMatch>
  parseGguf(path: string): Promise<ModelMeta>
  saveProfile(profile: ModelProfile): Promise<void>
  deleteProfile(name: string): Promise<void>
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

// 真实运行时，Rust 用 `skip_serializing_if("Option::is_none")` 把「未设置」的
// Option 字段直接省略（磁盘与 IPC 响应中都不出现该 key），因此这些字段在 JS 侧
// 是 `undefined` 而非 mock 层的 `null`。不少渲染点用 `x === null ? A : x.method()`
// 这种写法，在 `undefined` 上调用 `.method()` 会抛 TypeError 并让整棵树卸载（黑屏）。
// 这里在 API 边界把真实响应归一到「完整形状」：缺失的可选字段补成 `null`，与 mock
// 内部 `{ ...DEFAULT_CONFIG, ...parsed.config }` 的语义完全对齐，消除 mock/真实差异。
const DEFAULT_PROFILE: ModelProfile = {
  name: '',
  modelPath: '',
  mmprojPath: '',
  draftModelPath: '',
  ctxSize: null,
  gpuLayersMode: '',
  gpuLayersValue: 999,
  flashAttn: null,
}

const realApi: Api = {
  getSettings: () =>
    invoke<AppSettings>('get_settings').then((s) => ({
      ...s,
      config: { ...DEFAULT_CONFIG, ...s.config },
      profiles: s.profiles.map((p) => ({ ...DEFAULT_PROFILE, ...p })),
    })),
  saveSettings: (settings: AppSettings) =>
    invoke<void>('save_settings', { settingsInput: settings }),
  scanModelDirs: (roots: string[]) => invoke<ModelFile[]>('scan_model_dirs', { roots }),
  resolveMmproj: (modelPath: string, root: string) =>
    invoke<MmprojMatch>('resolve_mmproj', { modelPath, root }),
  resolveDraft: (modelPath: string, root: string) =>
    invoke<DraftMatch>('resolve_draft', { modelPath, root }),
  parseGguf: (path: string) => invoke<ModelMeta>('parse_gguf', { path }),
  saveProfile: (profile: ModelProfile) =>
    invoke<void>('save_profile', { profile }),
  deleteProfile: (name: string) => invoke<void>('delete_profile', { name }),
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

/** 环境自适应代理：Tauri 内走 Rust，common.browse器内走模拟层。 */
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
 * 把「settings.listenAddr」换算为本机客户端能真正连上的地址。
 *
 * `0.0.0.0` / `::` 只是通配绑定地址：Windows 拒绝向其发起连接
 * （WinError 10049），common.browse器也无法加载 `http://0.0.0.0:8080`。
 * 与 Rust 侧 `server::client_host` 保持同一语义。
 */
export function clientHost(host: string): string {
  const h = host.trim()
  return h === '' || h === '0.0.0.0' || h === '::' || h === '[::]' ? '127.0.0.1' : h
}

/** 供common.browse器打开的console.endpoint（settings.listenAddr已归一化）。 */
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
