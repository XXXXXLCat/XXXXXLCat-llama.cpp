// ---------------------------------------------------------------------------
// 架构推荐参数 + 显存预估
//
// 这两块功能都建立在 Feature 1 的 GGUF 元数据之上：
//   - 推荐参数按 architecture（qwen3 / llama / gemma …）套用预设；
//   - 显存预估用真实模型体积 + 层数 + 词向量维度 + 上下文长度估算 KV cache。
// 纯前端计算，GPU 总显存取自 SystemMetrics（实时轮询）。
// ---------------------------------------------------------------------------

const GB = 1_000_000_000

/**
 * 按架构套用的预设。硬件感知的启动参数（卸载层数 / 上下文 / KV 精度 / batch /
 * 线程 / 并行）在 recommendConfig 中据显存·内存·CPU 反解；这里给出架构级别的
 * 「采样推荐」——即 llama-server 的 server-side 默认采样参数（temp / top_k /
 * top_p / min_p / repeat_penalty / presence_penalty），按架构给合理默认。
 */
export interface ArchPreset {
  ctxSize: number
  flashAttn: 'auto' | 'true' | 'false'
  gpuLayersMode: 'auto' | 'all' | 'custom'
  // 采样推荐（字段名与 LaunchConfig 同名）
  temp: number
  topK: number
  topP: number
  minP: number
  repeatPenalty: number
  presencePenalty: number
}

const RECOMMENDED: Array<{ match: string; preset: ArchPreset }> = [
  {
    match: 'qwen3',
    preset: { ctxSize: 32768, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.7, topK: 40, topP: 0.8, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'qwen2',
    preset: { ctxSize: 32768, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.7, topK: 40, topP: 0.8, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'llama',
    preset: { ctxSize: 8192, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.8, topK: 40, topP: 0.9, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'gemma',
    preset: { ctxSize: 8192, flashAttn: 'true', gpuLayersMode: 'auto', temp: 1.0, topK: 40, topP: 0.95, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'deepseek',
    preset: { ctxSize: 4096, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.6, topK: 40, topP: 0.95, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'mistral',
    preset: { ctxSize: 8192, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.7, topK: 40, topP: 0.9, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'phi',
    preset: { ctxSize: 4096, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.7, topK: 40, topP: 0.9, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
  {
    match: 'glm',
    preset: { ctxSize: 8192, flashAttn: 'true', gpuLayersMode: 'auto', temp: 0.8, topK: 40, topP: 0.9, minP: 0.0, repeatPenalty: 1.1, presencePenalty: 0.0 },
  },
]

const DEFAULT_PRESET: ArchPreset = {
  ctxSize: 8192,
  flashAttn: 'auto',
  gpuLayersMode: 'auto',
  temp: 0.8,
  topK: 40,
  topP: 0.9,
  minP: 0.0,
  repeatPenalty: 1.1,
  presencePenalty: 0.0,
}

/** 按 architecture 字符串匹配推荐预设（含默认兜底）。 */
export function getRecommended(architecture: string | null): ArchPreset {
  if (!architecture) return DEFAULT_PRESET
  const lower = architecture.toLowerCase()
  for (const { match, preset } of RECOMMENDED) {
    if (lower.includes(match)) return preset
  }
  return DEFAULT_PRESET
}

export interface VramInput {
  /** 主模型文件体积（字节）。 */
  sizeBytes: number
  /** 层数（GGUF metadata.block_count），未知为 null。 */
  blockCount: number | null
  /** 词向量维度（metadata.embedding_length），未知为 null。 */
  embeddingLength: number | null
  /** KV 头数（metadata.head_count_kv，GQA），未知为 null。 */
  headCountKv: number | null
  /** 单头 K/V 维度（metadata.key_length），未知为 null。 */
  keyLength: number | null
  /** 上下文长度（-c），单位 token。 */
  ctxSize: number
  /** gpu_layers_mode: auto / all / custom。 */
  gpuLayersMode: string
  /** 自定义层数（mode=custom 时有效）。 */
  gpuLayersValue: number
  /** general.tensor_data_layout，如 "q8_0" 表示 KV 用 1 字节；未知为 null。 */
  tensorDataLayout: string | null
  /** 用户选定的 KV 缓存量化类型（如 "f16"/"q8_0"/"q4_0"），覆盖 tensorDataLayout
   * 决定 KV 字节/元素，使显存预估反映用户实际选择的 KV 精度。 */
  kvCacheType?: string | null
  /** 第一张 GPU 的总显存（字节），未知为 null。 */
  vramTotalBytes: number | null
}

/** KV 缓存量化类型 → 每元素字节数，用于显存预估反映用户所选精度。 */
export function kvBytesPerElemForCacheType(type: string | null): number {
  switch (type) {
    case 'q4_0':
    case 'q4_1':
      return 0.5
    case 'iq4_nl':
      return 0.5625
    case 'q5_0':
    case 'q5_1':
      return 0.625
    case 'q8_0':
      return 1
    default:
      return 2 // f16 / f32 / bf16 等
  }
}

export interface VramEstimate {
  weightsBytes: number
  kvBytes: number
  overheadBytes: number
  totalBytes: number
  vramTotalBytes: number | null
  /** total / vram，0–1+；无 GPU 信息为 null。 */
  ratio: number | null
  /** 是否放得下；无 GPU 信息为 null。 */
  fits: boolean | null
  /** KV 估算是否因缺少元数据而不可用。 */
  kvUnknown: boolean
}

/**
 * 估算 llama-server 在给定配置下的峰值显存占用：
 *   权重卸载 + KV cache + 固定开销。
 * KV cache 用 GQA 精确公式：ctx × 层数 × kv头数 × 单头维度 × 2(K+V) × 每元素字节。
 * 每元素字节默认 f16(2)；tensor_data_layout 为 "q8_0" 时按 1 字节（量化 KV）。
 */
export function estimateVram(input: VramInput): VramEstimate {
  const {
    sizeBytes,
    blockCount,
    embeddingLength,
    headCountKv,
    keyLength,
    ctxSize,
    gpuLayersMode,
    gpuLayersValue,
    tensorDataLayout,
    kvCacheType,
    vramTotalBytes,
  } = input

  // 权重卸载比例：auto/all 视为全卸载（峰值口径），custom 按层比例估算。
  let offloadFraction = 1
  if (gpuLayersMode === 'custom' && blockCount && blockCount > 0) {
    offloadFraction = Math.max(0, Math.min(1, gpuLayersValue / blockCount))
  }
  const weightsBytes = Math.round(sizeBytes * offloadFraction)

  // KV cache：优先用 GQA 精确公式（kv头数 × 单头维度），否则退回 embedding_length 近似。
  // 选了 KV 精度（kvCacheType）时以其为准，否则退回 tensor_data_layout（仅区分 q8_0）。
  const kvBytesPerElem =
    kvCacheType != null ? kvBytesPerElemForCacheType(kvCacheType) : tensorDataLayout === 'q8_0' ? 1 : 2
  const kvUnknown = blockCount == null || (headCountKv == null && embeddingLength == null)
  const kvBytes = kvUnknown
    ? 0
    : headCountKv != null && keyLength != null
      ? Math.round(ctxSize * blockCount! * headCountKv! * keyLength! * 2 * kvBytesPerElem)
      : Math.round(ctxSize * blockCount! * embeddingLength! * 2 * kvBytesPerElem)

  // 固定开销：运行时 + 计算缓冲，取 0.8 GB 与权重 10% 的较大值。
  const overheadBytes = Math.round(Math.max(0.8 * GB, weightsBytes * 0.1))

  const totalBytes = weightsBytes + kvBytes + overheadBytes
  const ratio = vramTotalBytes && vramTotalBytes > 0 ? totalBytes / vramTotalBytes : null
  const fits = vramTotalBytes && vramTotalBytes > 0 ? totalBytes <= vramTotalBytes : null

  return {
    weightsBytes,
    kvBytes,
    overheadBytes,
    totalBytes,
    vramTotalBytes,
    ratio,
    fits,
    kvUnknown,
  }
}

export function formatGB(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`
}

// ---------------------------------------------------------------------------
// 硬件感知推荐（Auto Config + Manual Override）
//
// 在「架构预设」之上再叠加硬件约束：按显存 / 内存 / CPU 核数反解出一套可
// 落地的启动参数。输出只是「初始推荐值」，不锁死参数——用户手动改过的键由
// 调用方依据 manualParams 跳过。
// ---------------------------------------------------------------------------

/** 推荐所需的模型信息（GGUF 元数据 + 真实文件体积）。 */
export interface RecommendModelInfo {
  sizeBytes: number
  blockCount: number | null
  embeddingLength: number | null
  headCountKv: number | null
  keyLength: number | null
  /** 模型训练上下文；未知为 null */
  contextLength: number | null
  tensorDataLayout: string | null
  /** MoE 专家数；>1 表示混合专家模型。未知为 null */
  expertCount: number | null
  /** 通用域；'reasoning' 表示思考模型。未知为 null */
  domain: string | null
  architecture: string | null
}

/** 推荐所需的硬件信息（取自 SystemMetrics）。 */
export interface RecommendHardware {
  vramTotalBytes: number | null
  ramTotalBytes: number | null
  cpuPhysicalCount: number | null
  cpuCount: number | null
}

export interface RecommendedConfig {
  gpuLayersMode: 'auto' | 'all' | 'custom'
  gpuLayersValue: number
  ctxSize: number | null
  cacheTypeK: string | null
  cacheTypeV: string | null
  batchSize: number | null
  ubatchSize: number | null
  threads: number | null
  flashAttn: string | null
  // 采样推荐（server-side 默认采样参数，按架构给值）
  temp: number
  topK: number
  topP: number
  minP: number
  repeatPenalty: number
  presencePenalty: number
  /** 推荐值下推算的显存占用（字节），供 UI 展示 */
  estimatedVramBytes: number
  /** 决策说明，供 UI 提示 */
  notes: string[]
}

/** 受自动推荐管理的参数键（camelCase，与 LaunchConfig 字段同名）。 */
export const MANAGED_PARAM_KEYS = [
  'gpuLayersMode',
  'gpuLayersValue',
  'ctxSize',
  'cacheTypeK',
  'cacheTypeV',
  'batchSize',
  'ubatchSize',
  'threads',
  'flashAttn',
] as const

/** 上下文候选档位，从大到小尝试。 */
const CTX_STEPS = [2048, 4096, 8192, 16384, 32768, 49152, 65536, 98304, 131072]

/** 部分卸载时的上下文下限：低于此值即便能多卸载几层也不再压缩。 */
const MIN_USABLE_CTX = 8192

/** KV 精度候选：优先保证质量，放不下再降精度。 */
const CACHE_TYPES: Array<{ type: string; bytesPerElem: number }> = [
  { type: 'f16', bytesPerElem: 2 },
  { type: 'q8_0', bytesPerElem: 1 },
  { type: 'q4_0', bytesPerElem: 0.5 },
]

/** 部分卸载时显存本就吃紧，不再考虑 f16。 */
const PARTIAL_CACHE_TYPES = CACHE_TYPES.filter((c) => c.type !== 'f16')

/** 单 token 的 KV 字节数；元数据不足时返回 null（与 estimateVram 同口径）。 */
function kvBytesPerToken(model: RecommendModelInfo, bytesPerElem: number): number | null {
  const { blockCount, headCountKv, keyLength, embeddingLength } = model
  if (blockCount == null || blockCount <= 0) return null
  if (headCountKv != null && keyLength != null) {
    return blockCount * headCountKv * keyLength * 2 * bytesPerElem
  }
  if (embeddingLength != null) return blockCount * embeddingLength * 2 * bytesPerElem
  return null
}

/**
 * 按「模型 + 硬件」推导一套推荐启动参数。
 *
 * 显存与内存都留了余量（显存 90% / 内存 75%），并优先尝试：
 *   全卸载 → 部分卸载（反解最大层数）→ 交由 llama-server 自动。
 * 部分卸载时，未卸载的权重会占用物理内存，因此同时校验内存是否放得下。
 */
export function recommendConfig(
  model: RecommendModelInfo,
  hw: RecommendHardware,
): RecommendedConfig {
  const preset = getRecommended(model.architecture)
  const notes: string[] = []
  const weights = model.sizeBytes
  const blockCount = model.blockCount != null && model.blockCount > 0 ? model.blockCount : null
  const overhead = Math.max(0.8 * GB, weights * 0.1)

  const vramBudget =
    hw.vramTotalBytes != null && hw.vramTotalBytes > 0 ? hw.vramTotalBytes * 0.9 : null
  const ramBudget =
    hw.ramTotalBytes != null && hw.ramTotalBytes > 0 ? hw.ramTotalBytes * 0.75 : null

  // 上下文上限：优先取模型训练上下文，缺失时退回架构预设
  const ctxCap =
    model.contextLength != null && model.contextLength > 0
      ? model.contextLength
      : preset.ctxSize
  const ctxCandidates = CTX_STEPS.filter((c) => c <= ctxCap).reverse()
  if (ctxCandidates.length === 0) ctxCandidates.push(CTX_STEPS[0])

  interface Combo {
    ctxSize: number
    cacheType: string
    kvBytes: number
    gpuLayersMode: 'auto' | 'all' | 'custom'
    gpuLayersValue: number
  }
  const ctxAsc = [...ctxCandidates].reverse()
  const kvUnknown = kvBytesPerToken(model, 2) == null

  // 阶段一：全量卸载。默认用 q8_0；只有显存宽裕到 f16 也能给到完整上下文时才
  // 升到 f16（质量最好但 KV 翻倍）。同一精度下取最大可容纳的上下文。
  const tryFullOffload = (): Combo | null => {
    if (vramBudget == null) return null
    const f16MinCtx = Math.min(ctxCap, 32768)
    for (const { type, bytesPerElem } of CACHE_TYPES) {
      const perToken = kvBytesPerToken(model, bytesPerElem)
      for (const ctxSize of ctxCandidates) {
        const kvBytes = perToken != null ? Math.round(ctxSize * perToken) : 0
        if (weights + kvBytes + overhead > vramBudget) continue
        // f16 若只能换来很短的上下文，就不如把显存让给上下文长度
        if (type === 'f16' && ctxSize < f16MinCtx) continue
        return {
          ctxSize,
          cacheType: type,
          kvBytes,
          gpuLayersMode: 'all',
          gpuLayersValue: blockCount ?? 0,
        }
      }
    }
    return null
  }

  // 阶段二：部分卸载，反解最大可卸载层数。未卸载的权重会占用物理内存，因此同时
  // 校验内存是否放得下。上下文从小到大尝试（层数越多越快），但不低于可用下限。
  const tryPartialOffload = (minCtx: number): Combo | null => {
    if (vramBudget == null || blockCount == null || weights <= 0) return null
    for (const { type, bytesPerElem } of PARTIAL_CACHE_TYPES) {
      const perToken = kvBytesPerToken(model, bytesPerElem)
      for (const ctxSize of ctxAsc) {
        if (ctxSize < minCtx) continue
        const kvBytes = perToken != null ? Math.round(ctxSize * perToken) : 0
        const maxLayers = Math.floor(((vramBudget - kvBytes - overhead) / weights) * blockCount)
        if (maxLayers <= 0) continue
        const layers = Math.max(1, Math.min(blockCount, maxLayers))
        const remaining = weights * (1 - layers / blockCount)
        if (ramBudget != null && remaining + 0.5 * GB > ramBudget) continue
        return {
          ctxSize,
          cacheType: type,
          kvBytes,
          gpuLayersMode: 'custom',
          gpuLayersValue: layers,
        }
      }
    }
    return null
  }

  const chosen: Combo =
    tryFullOffload() ??
    tryPartialOffload(MIN_USABLE_CTX) ??
    tryPartialOffload(0) ?? {
      // 完全放不下，或缺乏显存信息：交给 llama-server 自行决定
      ctxSize: ctxCandidates[0],
      cacheType: 'q8_0',
      kvBytes: 0,
      gpuLayersMode: 'auto',
      gpuLayersValue: blockCount ?? 0,
    }

  if (chosen.gpuLayersMode === 'auto') {
    notes.push('未找到完全适配显存/内存的组合，已回退为自动卸载，可手动调整')
  }
  if (kvUnknown) notes.push('缺少层数或 KV 头元数据，KV 显存按 0 估算')
  if (vramBudget == null) notes.push('未检测到 GPU 显存信息，卸载层数交由 llama-server 决定')

  const offloaded =
    chosen.gpuLayersMode === 'custom' && blockCount
      ? weights * (chosen.gpuLayersValue / blockCount)
      : weights
  const estimatedVramBytes = Math.round(offloaded + chosen.kvBytes + overhead)
  // 用「占总显存的比例」而非「占预算的比例」判断吃紧程度：预算本身已打了 9 折。
  const usageRatio =
    hw.vramTotalBytes != null && hw.vramTotalBytes > 0
      ? estimatedVramBytes / hw.vramTotalBytes
      : 0

  // 权重与 KV 才是显存大头，batch 只在极端吃紧时才降档，否则维持 2048/512。
  const batchSize = usageRatio > 0.95 ? 1024 : 2048
  const ubatchSize = Math.max(256, Math.round(batchSize / 4))

  // 线程数取物理核心（超线程对 llama.cpp 收益有限），不超过逻辑线程数
  const logical = hw.cpuCount != null && hw.cpuCount > 0 ? hw.cpuCount : null
  const physical =
    hw.cpuPhysicalCount != null && hw.cpuPhysicalCount > 0
      ? hw.cpuPhysicalCount
      : logical != null
        ? Math.max(1, Math.floor(logical / 2))
        : null
  const threads =
    physical != null && logical != null
      ? Math.max(1, Math.min(physical, logical))
      : (physical ?? null)

  return {
    gpuLayersMode: chosen.gpuLayersMode,
    gpuLayersValue: chosen.gpuLayersValue,
    ctxSize: chosen.ctxSize,
    cacheTypeK: chosen.cacheType,
    cacheTypeV: chosen.cacheType,
    batchSize,
    ubatchSize,
    threads,
    flashAttn: preset.flashAttn,
    temp: preset.temp,
    topK: preset.topK,
    topP: preset.topP,
    minP: preset.minP,
    repeatPenalty: preset.repeatPenalty,
    presencePenalty: preset.presencePenalty,
    estimatedVramBytes,
    notes,
  }
}
