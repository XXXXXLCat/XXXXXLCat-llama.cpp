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
  ModelMeta,
  ModelProfile,
  DraftMatch,
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
  draft?: { name: string; sizeBytes: number }
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
    draft: {
      name: 'mtp-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_0.gguf',
      sizeBytes: 2200584192,
    },
  },
  {
    dir: 'unsloth\\Qwen3.8-27B-GGUF',
    family: 'Qwen3.8-27B',
    quant: 'Q4_K_M',
    text: { name: 'Qwen3.8-27B-Q4_K_M.gguf', sizeBytes: 17106773984 },
    mmproj: { name: 'mmproj-F16.gguf', sizeBytes: 927607488 },
    draft: { name: 'mtp-Qwen3.8-27B-Q4_0.gguf', sizeBytes: 1805878272 },
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
    if (e.draft) {
      out.push({
        path: `${MODEL_ROOT}\\${e.dir}\\${e.draft.name}`,
        name: e.draft.name,
        dir: e.dir,
        sizeBytes: e.draft.sizeBytes,
        kind: 'draft',
        family: e.family,
        quant: 'Q4_0',
        params: e.family.includes('35B') ? '35B-A3B' : e.family.includes('27B') ? '27B' : '31B',
      })
    }
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

  draftModelPath: '',
  autoDraft: true,

  host: '127.0.0.1',
  port: 8080,
  // 以下可选项默认一律为 null（未设置 = 启动时不下发，由 llama-server 取默认值）
  parallel: null,
  contBatching: null,
  timeout: null,
  threadsHttp: null,
  alias: '',
  apiKey: '',
  metrics: null,
  props: null,
  slotsEndpoint: null,
  webui: null,
  embedding: null,
  jinja: null,

  ctxSize: null,
  batchSize: null,
  ubatchSize: null,
  threads: null,
  threadsBatch: null,
  gpuLayersMode: '',
  gpuLayersValue: 999,
  flashAttn: null,
  splitMode: null,
  tensorSplit: '',
  mainGpu: null,
  device: '',
  kvOffload: null,
  cacheTypeK: null,
  cacheTypeV: null,
  loadMode: null,
  numa: '',
  lora: '',
  cachePrompt: null,
  cacheReuse: null,
  cpuMoe: null,
  nCpuMoe: null,
  nCpuFfn: null,
  imageMinTokens: null,
  imageMaxTokens: null,

  ropeScaling: '',
  ropeScale: null,
  yarnOrigCtx: null,
  yarnExtFactor: null,
  yarnAttnFactor: null,
  yarnBetaSlow: null,
  yarnBetaFast: null,

  mmprojOffload: null,
  mmprojDevice: '',

  verbosity: null,
  logTimestamps: null,
  logFile: '',
  logColors: '',
  logPrefix: null,

  fit: null,
  fitTarget: '',
  fitCtx: null,
  cacheRam: null,
  kvUnified: null,
  kvUnifiedPerSlot: null,
  cacheIdleSlots: null,
  swaFull: null,
  keep: null,
  contextShift: null,
  ctxCheckpoints: null,
  checkpointMinStep: null,

  predict: null,
  samplers: '',
  samplerSeq: '',
  seed: null,
  ignoreEos: null,
  temp: null,
  topK: null,
  topP: null,
  minP: null,
  topNsigma: null,
  xtcProbability: null,
  xtcThreshold: null,
  typicalP: null,
  repeatLastN: null,
  repeatPenalty: null,
  presencePenalty: null,
  frequencyPenalty: null,
  dryMultiplier: null,
  dryBase: null,
  dryAllowedLength: null,
  dryPenaltyLastN: null,
  drySequenceBreaker: '',
  adaptiveTarget: null,
  adaptiveDecay: null,
  dynatempRange: null,
  dynatempExp: null,
  mirostat: null,
  mirostatLr: null,
  mirostatEnt: null,
  logitBias: '',
  grammar: '',
  grammarFile: '',
  jsonSchema: '',
  jsonSchemaFile: '',
  backendSampling: null,

  overrideTensor: '',
  repack: null,
  noHost: null,
  lazyMode: null,
  directIo: null,
  mlock: null,
  mmap: null,
  checkTensors: null,
  overrideKv: '',
  opOffload: null,
  rpc: '',
  cpuMask: '',
  cpuRange: '',
  cpuStrict: null,
  prio: null,
  poll: null,

  specType: '',
  specDraftNMax: null,
  specDraftNMin: null,
  specDraftPSplit: null,
  specDraftPMin: null,
  specDraftNgl: '',
  specDraftDevice: '',
  specDraftCpuMoe: null,
  specDraftNCpuMoe: null,
  specDraftThreads: null,
  specNgramModNMin: null,
  specNgramModNMax: null,
  specNgramModNMatch: null,
  specNgramSimpleSizeN: null,
  specNgramSimpleSizeM: null,
  specNgramSimpleMinHits: null,
  specNgramMapKSizeN: null,
  specNgramMapKSizeM: null,
  specNgramMapKMinHits: null,
  specNgramMapK4vSizeN: null,
  specNgramMapK4vSizeM: null,
  specNgramMapK4vMinHits: null,

  reusePort: null,
  apiPrefix: '',
  staticPath: '',
  corsOrigins: '',
  corsMethods: '',
  corsHeaders: '',
  corsCredentials: null,
  sslKeyFile: '',
  sslCertFile: '',
  apiKeyFile: '',
  ssePingInterval: null,
  mediaPath: '',
  slotSavePath: '',
  modelsDir: '',
  modelsPreset: '',
  modelsMax: null,
  modelsAutoload: null,
  rerank: null,
  sleepIdleSeconds: null,
  logPromptsDir: '',

  chatTemplate: '',
  chatTemplateFile: '',
  chatTemplateKwargs: '',
  reasoningFormat: '',
  reasoning: null,
  reasoningEffort: '',
  reasoningBudget: null,
  reasoningPreserve: null,
  skipChatParsing: null,
  prefillAssistant: null,
  pooling: '',
  embdNormalize: null,
  slotPromptSimilarity: null,
  warmup: null,
  lookupCacheStatic: '',
  lookupCacheDynamic: '',
  loraScaled: '',
  loraInitWithoutApply: null,
  controlVector: '',
  controlVectorScaled: '',
  controlVectorLayerRange: '',
  spmInfill: null,
  special: null,
  offline: null,

  mmprojAuto: null,
  mmprojUrl: '',
  mtmdBatchMaxTokens: null,
  videoFps: null,
  videoTimestampInterval: null,
  videoFfmpegDir: '',
  tags: '',

  // batch / CPU affinity (batch variants)
  cpuMaskBatch: '',
  cpuRangeBatch: '',
  cpuStrictBatch: null,
  prioBatch: null,
  pollBatch: null,
  // rope freq (NTK-aware)
  ropeFreqBase: null,
  ropeFreqScale: null,
  // speculative decoding: draft KV cache types
  specDraftTypeK: null,
  specDraftTypeV: null,
  // speculative decoding: draft CPU / perf
  specDraftThreadsBatch: null,
  specDraftCpuMask: '',
  specDraftCpuRange: '',
  specDraftCpuStrict: null,
  specDraftPrio: null,
  specDraftPoll: null,
  specDraftCpuMaskBatch: '',
  specDraftCpuStrictBatch: null,
  specDraftPrioBatch: null,
  specDraftPollBatch: null,
  specDraftOverrideTensor: '',
  specDraftBackendSampling: null,
  // logging extras
  logDisable: null,
  perf: null,
  // inference behaviour
  reversePrompt: '',
  escape: null,
  // WebUI / agent / tools
  uiConfig: '',
  uiConfigFile: '',
  uiMcpProxy: null,
  tools: '',
  toolsRuntime: '',
  mcpServersConfig: '',
  mcpServersJson: '',
  agent: null,
  // reasoning extras
  reasoningBudgetMessage: '',

  extraArgs: '',
  killOnExit: true,
  autoOpenBrowser: false,
  autoGotoWebui: true,
  cleanVramOnStart: true,

  manualParams: [],
}

// ---------------------------------------------------------------- 内部状态

export interface MockApi {
  getSettings(): Promise<AppSettings>
  saveSettings(s: AppSettings): Promise<void>
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
          modelLibraries: parsed.modelLibraries?.length
            ? parsed.modelLibraries
            : [DEFAULT_CONFIG.modelRoot],
          profiles: parsed.profiles ?? [],
        }
      }
    } catch {
      // ignore corrupted storage
    }
    return {
      config: { ...DEFAULT_CONFIG },
      lastModelRoot: MODEL_ROOT,
      modelLibraries: [DEFAULT_CONFIG.modelRoot],
      profiles: [],
    }
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
      `llama_new_context_with_model: n_ctx = ${config.ctxSize ?? 4096}`,
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
    if (config.draftModelPath) args.push('--model-draft', config.draftModelPath)
    args.push('--host', config.host, '--port', String(config.port))
    return args
  }

  const api: MockApi = {
    async getSettings() {
      return settings
    },
    async saveSettings(s) {
      settings = {
        config: s.config,
        lastModelRoot: s.lastModelRoot || MODEL_ROOT,
        modelLibraries: s.modelLibraries?.length ? s.modelLibraries : [s.config.modelRoot],
        profiles: s.profiles ?? [],
      }
      persist()
    },
    async scanModelDirs(roots) {
      await sleep(450)
      // The mock only has one snapshot root; return it regardless of `roots`.
      return buildModelFiles()
    },
    async saveProfile(profile) {
      settings.profiles = settings.profiles.filter((p) => p.name !== profile.name)
      settings.profiles.push(profile)
      persist()
    },
    async deleteProfile(name) {
      settings.profiles = settings.profiles.filter((p) => p.name !== name)
      persist()
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
    async resolveDraft(modelPath, _root) {
      await sleep(180)
      const files = buildModelFiles()
      const text = files.find((m) => m.kind === 'text' && m.path === modelPath)
      if (!text) {
        return { draftPath: null, confidence: 'none', score: 0, candidates: [] }
      }
      const candidates = files
        .filter((m) => m.kind === 'draft' && m.dir === text.dir)
        .map((m) => m.path)
      return {
        draftPath: candidates[0] ?? null,
        confidence: candidates.length ? 'exact' : 'none',
        score: candidates.length ? 1 : 0,
        candidates,
      }
    },
    async parseGguf(path) {
      await sleep(220)
      const name = (path.split(/[\\/]/).pop() || 'model.gguf').replace(/\.gguf$/i, '')
      const quant =
        /\b(Q[2-8]_[K0-9]+|IQ\d[^.\s]*|F16|F32|BF16)\b/i.exec(name)?.[1]?.toUpperCase() ?? null
      const architecture = /qwen/i.test(name)
        ? 'qwen3'
        : /llama/i.test(name)
          ? 'llama'
          : /deepseek/i.test(name)
            ? 'deepseek2'
            : 'unknown'
      const extra: Record<string, string> = {
        'general.architecture': architecture,
        'general.basename': name,
        'general.quantization_version': '2',
        'general.size_label': '27B',
        [`${architecture}.context_length`]: '32768',
        [`${architecture}.embedding_length`]: '5120',
        [`${architecture}.block_count`]: '48',
        [`${architecture}.attention.head_count`]: '40',
        [`${architecture}.attention.head_count_kv`]: '8',
        [`${architecture}.attention.key_length`]: '128',
        [`${architecture}.attention.value_length`]: '128',
        [`${architecture}.attention.layer_norm_rms_epsilon`]: '0.000001',
        [`${architecture}.attention.causal`]: 'true',
        [`${architecture}.rope.dimension_count`]: '128',
        [`${architecture}.rope.freq_base`]: '1000000',
        'tokenizer.ggml.model': 'qwen2',
        'tokenizer.ggml.pre': 'qwen2',
      }
      return {
        architecture,
        name,
        author: 'Qwen',
        basename: name,
        finetune: null,
        description: null,
        license: 'other',
        tags: ['chat'],
        languages: ['zh', 'en'],
        domain: 'llm',
        formatVersion: 3,
        fileVersion: null,
        quantizationVersion: 2,
        tensorDataLayout: quant ? quant.toLowerCase() : null,
        paramCount: 27_000_000_000,
        contextLength: 32768,
        sizeLabel: '27B',
        quant,
        fileType: null,
        vocabSize: 151936,
        embeddingLength: 5120,
        blockCount: 48,
        chatTemplate: null,
        headCount: 40,
        headCountKv: 8,
        keyLength: 128,
        valueLength: 128,
        normEpsilon: 1e-6,
        causal: true,
        ropeFreqBase: 1_000_000,
        ropeDim: 128,
        ropeScaleLinear: null,
        ropeScalingType: null,
        slidingWindow: null,
        poolingType: null,
        expertCount: null,
        expertUsedCount: null,
        bosTokenId: 151643,
        eosTokenId: 151645,
        tokenizerModel: 'qwen2',
        tokenizerPre: 'qwen2',
        addBos: true,
        addEos: false,
        extra,
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
        cpu_count: 24,
        cpu_physical_count: 12,
        memory_used: 9_400_000_000 + Math.round(Math.sin(t / 7) * 800_000_000),
        memory_total: 32_000_000_000,
        gpus: [gpu],
        cpu_name: 'AMD Ryzen 9 3900X 12-Core Processor (模拟)',
        llama_version: '0.4.0-dev (build 10819, commit 6a1a922d2)',
        app_version: '0.1.2',
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
