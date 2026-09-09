export interface ParsedModelId {
  modelName: string | null
  params: string | null
  quantization: string | null
  orgName: string | null
}

const QUANTIZATION_SEGMENT_RE = /^(I?Q\d+(_[A-Z0-9]+)*|F\d+|BF\d+|MXFP\d+(_[A-Z0-9]+)*)$/i
const PARAMS_RE = /^[Ee]?\d+(\.\d+)?[BbMmKkTt]$/
const WEIGHT_EXTENSION_RE = /\.(gguf|ggml)$/i
const IGNORED_SEGMENTS = new Set(['GGUF', 'GGML'])

/** 对齐 llama.cpp 原版 ModelsService.parseModelId */
export function parseModelId(modelId: string): ParsedModelId {
  const result: ParsedModelId = { modelName: null, params: null, quantization: null, orgName: null }
  if (!modelId.trim()) return result

  const segments = modelId.trim().split(/[\\/]/)
  let source: string
  if (segments.length === 2 && segments[0] && segments[1]) {
    source = `${segments[0].trim()}/${segments[1].trim()}`
  } else {
    source = segments[segments.length - 1]?.trim() || modelId.trim()
  }
  source = source.replace(WEIGHT_EXTENSION_RE, '')

  const colonIdx = source.indexOf(':')
  let modelPath: string
  if (colonIdx !== -1) {
    result.quantization = source.slice(colonIdx + 1) || null
    modelPath = source.slice(0, colonIdx)
  } else {
    modelPath = source
  }

  const slashIdx = modelPath.indexOf('/')
  let modelStr: string
  if (slashIdx !== -1) {
    result.orgName = modelPath.slice(0, slashIdx)
    modelStr = modelPath.slice(slashIdx + 1)
  } else {
    modelStr = modelPath
  }

  const dotIdx = modelStr.lastIndexOf('.')
  if (dotIdx !== -1 && !result.quantization) {
    const afterDot = modelStr.slice(dotIdx + 1)
    if (QUANTIZATION_SEGMENT_RE.test(afterDot)) {
      result.quantization = afterDot
      modelStr = modelStr.slice(0, dotIdx)
    }
  }

  const segs = modelStr.split('-')
  if (!result.quantization && segs.length > 1) {
    const last = segs[segs.length - 1]
    if (QUANTIZATION_SEGMENT_RE.test(last)) {
      result.quantization = last
      segs.pop()
    }
  }

  let paramsIdx = -1
  for (let i = 0; i < segs.length; i++) {
    if (PARAMS_RE.test(segs[i])) {
      paramsIdx = i
      result.params = segs[i].toUpperCase()
      break
    }
  }

  const pivotIdx = paramsIdx !== -1 ? paramsIdx : segs.length
  const modelSegments = segs.slice(0, pivotIdx)
  while (modelSegments.length > 0 && IGNORED_SEGMENTS.has(modelSegments[modelSegments.length - 1].toUpperCase())) {
    modelSegments.pop()
  }
  result.modelName = modelSegments.join('-') || null

  return result
}

export function formatModelName(modelId: string): string {
  return parseModelId(modelId).modelName || modelId
}

export function parseModelSize(modelId: string): string | null {
  return parseModelId(modelId).params
}
