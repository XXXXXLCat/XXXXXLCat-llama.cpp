import * as React from 'react'

// ---------------------------------------------------------------------------
// 语言偏好：跟随系统 / 英文 / 中文
// 采用「短语本」模式：中文即源文本（key），英文在 EN 字典中逐条翻译。
// 因此 zh 环境下 t(中文) 恒等于原文，仅 en 环境做替换；缺失翻译时回退中文。
// ---------------------------------------------------------------------------

export type LocalePref = 'system' | 'en' | 'zh'
export type ResolvedLocale = 'en' | 'zh'

export const LOCALES: { value: LocalePref; zh: string; en: string }[] = [
  { value: 'system', zh: '跟随系统', en: 'Follow system' },
  { value: 'en', zh: '英文', en: 'English' },
  { value: 'zh', zh: '中文', en: '中文' },
]

const LOCALE_KEY = 'app-locale'

export function getStoredLocale(): LocalePref {
  const v = localStorage.getItem(LOCALE_KEY)
  return v === 'en' || v === 'zh' || v === 'system' ? v : 'system'
}

export function resolveLocale(pref: LocalePref): ResolvedLocale {
  if (pref === 'en') return 'en'
  if (pref === 'zh') return 'zh'
  const nav = (navigator.language || 'zh').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

/** 持久化语言偏好并立即应用到 <html> */
export function setLocale(pref: LocalePref) {
  localStorage.setItem(LOCALE_KEY, pref)
  const resolved = resolveLocale(pref)
  currentResolved = resolved
  document.documentElement.lang = resolved === 'zh' ? 'zh-CN' : 'en'
  document.documentElement.setAttribute('data-locale', resolved)
}

/** 应用启动时的初始语言（在 React 挂载前调用，避免闪烁） */
export function applyInitialPreferences() {
  setLocale(getStoredLocale())
}

// 模块级当前解析语言，供 translate 同步读取
let currentResolved: ResolvedLocale = resolveLocale(getStoredLocale())

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

// ---------------------------------------------------------------------------
// 英文翻译字典（key = 中文源文本）
// ---------------------------------------------------------------------------
const EN: Record<string, string> = {
  // 通用 / 导航
  '正在读取配置…': 'Loading config…',
  '控制台': 'Console',
  '模型': 'Models',
  '运行日志': 'Logs',
  '参数设置': 'Parameters',
  '偏好设置': 'Preferences',
  '跟随系统': 'Follow system',
  '扫描失败': 'Scan failed',
  '未选择': 'Not selected',
  '未启用': 'Not enabled',
  // 标题栏窗口控制
  '最小化': 'Minimize',
  '向下还原': 'Restore',
  '最大化': 'Maximize',
  '关闭': 'Close',
  // 状态徽标
  'llama.cpp 未启动': 'llama.cpp not running',
  '模型加载中': 'Loading model',
  'llama.cpp 运行中': 'llama.cpp running',
  // 控制台页
  '启动或停止 llama.cpp 服务，并查看模型与运行时状态':
    'Start or stop the llama.cpp server and view model & runtime status',
  '停止服务': 'Stop server',
  '启动服务': 'Start server',
  '操作失败': 'Action failed',
  '知道了': 'Got it',
  '尚未选择主模型': 'No main model selected',
  '请先到': 'Go to the',
  '页面选择一个 GGUF 主模型。': 'page and pick a GGUF main model.',
  '运行状态': 'Runtime status',
  '进程信息与服务地址': 'Process info and service endpoint',
  '打开 Web UI': 'Open Web UI',
  '内置 Web UI 已在参数设置中关闭': 'The built-in Web UI is disabled in Parameters',
  '服务地址': 'Endpoint',
  '进程 ID': 'Process ID',
  '运行时长': 'Uptime',
  '退出码': 'Exit code',
  '0（正常）': '0 (normal)',
  '{code}（异常）': '{code} (error)',
  '连续批处理': 'Continuous batching',
  '启用': 'Enabled',
  '禁用': 'Disabled',
  '上下文长度': 'Context length',
  '当前模型': 'Current model',
  '主模型与视觉投影': 'Main model and vision projector',
  '主模型': 'Main model',
  '视觉模型': 'Vision model',
  '文件体积': 'File size',
  '系统监控': 'System monitor',
  'CPU / 内存 / GPU 利用率 / 显存 / 温度（每 2 秒刷新）':
    'CPU / memory / GPU util / VRAM / temperature (refreshes every 2s)',
  'GPU：': 'GPU: ',
  '未检测到 GPU': 'No GPU detected',
  'CPU 占用': 'CPU usage',
  '内存': 'Memory',
  'GPU 利用率': 'GPU utilization',
  'GPU {i} 利用率': 'GPU {i} utilization',
  '显存': 'VRAM',
  '温度': 'Temp',
  '正在读取硬件信息…': 'Reading hardware info…',
  '实时日志': 'Live logs',
  '最近 {n} 行': 'Last {n} lines',
  '查看全部': 'View all',
  '参数有未保存的修改': 'There are unsaved changes',
  '保存参数': 'Save parameters',
  '服务启动后将在此显示日志': 'Logs will appear here once the server starts',
  // 模型页
  '选择主模型，系统会自动匹配同目录的视觉投影（mmproj）文件':
    'Pick a main model; the launcher auto-matches a same-directory vision projector (mmproj)',
  '模型目录': 'Model directory',
  '扫描目录下的所有 GGUF 文件': 'Scan all GGUF files under the directory',
  '重新扫描': 'Rescan',
  '浏览': 'Browse',
  '主模型 {n} 个文本模型': '{n} text model(s)',
  '共 {n} 个文本模型': '{n} text model(s)',
  '搜索': 'Search',
  '正在扫描模型目录…': 'Scanning model directory…',
  '未找到 GGUF 主模型，请检查模型目录': 'No GGUF main model found; check the model directory',
  '视觉模型匹配': 'Vision model matching',
  '多模态投影（mmproj）': 'Multimodal projector (mmproj)',
  '自动匹配视觉模型': 'Auto-match vision model',
  '依据主模型名称与同目录关系自动选取': 'Auto-selected by main model name and same-directory relation',
  '相关度 {p}%': 'Relevance {p}%',
  '打开文件位置': 'Open file location',
  '未找到可用视觉模型': 'No usable vision model found',
  '手动指定视觉投影文件': 'Manually specify a vision projector file',
  '不启用视觉模型': 'No vision model',
  '当前模型目录中没有检测到视觉投影文件': 'No vision projector file detected in the current model directory',
  '视觉投影': 'Vision',
  '精确匹配': 'Exact match',
  '目录唯一': 'Directory unique',
  '弱匹配': 'Weak match',
  '未找到': 'Not found',
  '视觉模型与主模型名称高度一致，可直接启用。':
    'Vision model name closely matches the main model; safe to enable.',
  '主模型所在目录内仅有一个视觉投影文件，已按同目录关系自动选用。':
    'Only one projector file in the main model directory; auto-selected by same-directory relation.',
  '存在多个候选且名称相关性较低，建议人工确认后再启动。':
    'Multiple candidates with low name relevance; please confirm manually before launch.',
  '未能在模型目录中找到可用的视觉投影文件。':
    'No usable vision projector file found in the model directory.',
  '已选择': 'Selected',
  // 日志页
  'llama-server 进程输出与启动器消息，共 {n} 行':
    'llama-server process output and launcher messages, {n} lines',
  '日志输出': 'Log output',
  '显示最近 {n} 行': 'Showing last {n} lines',
  '（共 {n} 行匹配）': '({n} lines matched)',
  '全部输出': 'All output',
  '标准输出': 'Stdout',
  '标准错误': 'Stderr',
  '启动器消息': 'Launcher',
  '复制': 'Copy',
  '清空': 'Clear',
  '过滤日志内容': 'Filter log content',
  '自动滚动': 'Auto-scroll',
  '暂无日志，启动服务后将实时输出': 'No logs yet; live output appears after the server starts',
  // 设置页
  '所有参数对应 llama-server 命令行选项，修改后需重启服务生效':
    'All parameters map to llama-server CLI flags; restart the server to apply changes',
  '撤销更改': 'Revert changes',
  '路径': 'Paths',
  'llama.cpp 目录与模型文件位置': 'llama.cpp directory and model file locations',
  'llama.cpp 目录': 'llama.cpp directory',
  '包含 llama-server.exe 与 ggml/cuda 动态库的目录':
    'Directory containing llama-server.exe and the ggml/cuda dynamic libraries',
  '服务程序': 'Server binary',
  '相对上述目录的文件名，或填写完整绝对路径':
    'Filename relative to the directory above, or a full absolute path',
  '服务与网络': 'Server & network',
  'HTTP 服务监听与接口开关': 'HTTP listener and endpoint toggles',
  '监听地址': 'Listen address',
  '127.0.0.1 仅本机可访问，0.0.0.0 允许局域网访问（本机打开 Web UI 时会自动改用 127.0.0.1）':
    '127.0.0.1 is local-only; 0.0.0.0 allows LAN access (opens as 127.0.0.1 on this machine)',
  '端口': 'Port',
  'HTTP 服务监听端口，需未被其他程序占用': 'HTTP listen port; must be free',
  '并行槽位 (-np)': 'Parallel slots (-np)',
  '-1 表示按显存自动决定': '-1 = auto by VRAM',
  '读写超时（秒）': 'Read/write timeout (s)',
  '单个请求的最大等待时间，超时后断开连接':
    'Max wait per request; the connection drops on timeout',
  'HTTP 线程数': 'HTTP threads',
  '-1 表示自动': '-1 = auto',
  '模型别名 (-a)': 'Model alias (-a)',
  'API 中显示的模型名称': 'Model name shown in the API',
  'API Key': 'API Key',
  '留空表示不启用鉴权': 'Leave empty to disable auth',
  '允许多个请求并行解码': 'Allow multiple requests to decode in parallel',
  '关闭后仅保留 OpenAI 兼容接口，「打开 Web UI」按钮将不可用':
    'Disables the built-in UI; only the OpenAI-compatible API remains',
  '槽位监控端点': 'Slots endpoint',
  '开放 /slots 查看各并行槽位的实时占用情况':
    'Expose /slots to inspect live occupancy of parallel slots',
  'Prometheus 指标': 'Prometheus metrics',
  '开放 /metrics 供监控系统采集吞吐与延迟':
    'Expose /metrics for monitoring systems to scrape throughput & latency',
  '运行时属性修改 (/props)': 'Runtime props (/props)',
  '允许通过 API 在不重启服务的情况下调整采样参数':
    'Allow tuning sampling params via API without restarting',
  '嵌入模型模式': 'Embedding mode',
  '仅用于专用嵌入模型，会禁用生成接口':
    'For dedicated embedding models only; disables the generation endpoint',
  'Jinja 聊天模板': 'Jinja chat template',
  '使用模型内置模板格式化对话，工具调用需开启':
    'Use the model\'s built-in template for chat; required for tool calls',
  '模型与显存': 'Model & VRAM',
  '层卸载、KV 缓存与多 GPU 切分': 'Layer offload, KV cache and multi-GPU split',
  'GPU 层数模式 (-ngl)': 'GPU layers mode (-ngl)',
  '决定多少层权重卸载到显存，卸载越多推理越快':
    'How many weight layers to offload to VRAM; more = faster',
  '自定义 GPU 层数': 'Custom GPU layers',
  '仅当模式为 custom 时生效': 'Only used when mode is custom',
  '融合注意力算子，可降低显存并提速；auto 由后端自行判断':
    'Fused attention kernel; saves VRAM and speeds up; auto = backend decides',
  '多 GPU 切分模式': 'Multi-GPU split mode',
  '多卡时模型如何拆分到各张卡；单卡请选 none':
    'How the model splits across GPUs; pick none for a single GPU',
  '主 GPU 索引': 'Main GPU index',
  '存放 KV 缓存与中间张量的主卡编号，从 0 开始':
    'Index of the GPU holding KV cache & intermediate tensors, starting at 0',
  '张量切分比例 (-ts)': 'Tensor split (-ts)',
  '设备列表 (-dev)': 'Device list (-dev)',
  '模型加载模式 (-lm)': 'Model load mode (-lm)',
  '权重读取方式；mmap 省内存，mlock 锁定物理内存防换页':
    'Weight read method; mmap saves RAM, mlock pins physical RAM',
  'NUMA 策略': 'NUMA policy',
  '多路 CPU 的内存亲和性优化，单路机器保持默认':
    'Memory affinity for multi-socket CPUs; keep default on single-socket',
  'K 缓存数据类型 (-ctk)': 'K cache type (-ctk)',
  'Key 缓存量化精度，降低精度可显著节省显存':
    'K-cache quantization precision; lower precision saves VRAM',
  'V 缓存数据类型 (-ctv)': 'V cache type (-ctv)',
  'Value 缓存量化精度，通常与 K 缓存保持一致':
    'V-cache quantization precision; usually match the K cache',
  'KV 缓存卸载到 GPU': 'Offload KV cache to GPU',
  '关闭后 KV 缓存留在内存，省显存但会降速':
    'When off, KV cache stays in RAM; saves VRAM but slower',
  '上下文与批处理': 'Context & batching',
  '显存占用的主要来源': 'The main source of VRAM usage',
  '上下文长度 (-c)': 'Context length (-c)',
  '0 表示使用模型训练上下文': '0 = model\'s trained context',
  '逻辑批处理大小 (-b)': 'Logical batch (-b)',
  '一次提交给后端的最大 token 数，影响预填充吞吐':
    'Max tokens submitted per batch; affects prefill throughput',
  '物理批处理大小 (-ub)': 'Physical batch (-ub)',
  '单次实际计算的 token 数，需不大于逻辑批处理大小':
    'Tokens computed per step; must be ≤ logical batch',
  '生成线程数 (-t)': 'Gen threads (-t)',
  '批处理线程数 (-tb)': 'Batch threads (-tb)',
  '最大生成长度 (-n)': 'Max tokens (-n)',
  '-1 表示不限制': '-1 = unlimited',
  '采样参数': 'Sampling',
  '服务端默认采样行为，可被请求参数覆盖':
    'Server-side default sampling; can be overridden per request',
  '采样温度，越大越随机；0 表示贪心解码':
    'Higher = more random; 0 = greedy decoding',
  '核采样阈值，仅从累积概率前 P 的候选中取样；1 表示禁用':
    'Nucleus threshold; sample from top-P cumulative prob; 1 = disabled',
  '仅保留概率最高的 K 个候选；0 表示禁用':
    'Keep only the top-K candidates; 0 = disabled',
  '按最高概率的相对比例过滤低概率候选；0 表示禁用':
    'Filter low-prob candidates by relative top prob; 0 = disabled',
  '重复惩罚': 'Repeat penalty',
  '对已出现过的 token 降权，1 表示不惩罚':
    'Down-weight repeated tokens; 1 = no penalty',
  '重复回看长度': 'Repeat last N',
  '参与重复惩罚统计的最近 token 数；0 表示禁用':
    'Recent tokens counted for repeat penalty; 0 = disabled',
  '存在惩罚': 'Presence penalty',
  '对出现过的 token 施加固定惩罚，抑制复述；0 表示禁用':
    'Fixed penalty for seen tokens to reduce repetition; 0 = disabled',
  '频率惩罚': 'Frequency penalty',
  '按出现次数递增惩罚，抑制高频词刷屏；0 表示禁用':
    'Increasing penalty by frequency to curb repeated words; 0 = disabled',
  '随机种子 (-s)': 'Seed (-s)',
  '-1 表示每次随机': '-1 = random each run',
  'RoPE 与多模态': 'RoPE & multimodal',
  '长上下文扩展与视觉投影卸载': 'Long-context scaling and vision offload',
  '位置编码外推算法，用于超出模型训练长度的上下文':
    'Position encoding extrapolation for beyond-trained context',
  '仅在启用缩放时生效': 'Only used when scaling is enabled',
  '关闭后 mmproj 在 CPU 上推理': 'When off, mmproj runs on CPU',
  '视觉投影设备 (-mmdev)': 'Vision device (-mmdev)',
  '留空表示跟随主设备；填 none 表示不卸载':
    'Empty follows the main device; none = no offload',
  '输出到启动器日志窗口的详细程度': 'Verbosity of the launcher log window',
  '级别越高输出越详细，排查问题时可调至追踪或调试':
    'Higher = more detail; raise to trace/debug when troubleshooting',
  '日志时间戳': 'Log timestamps',
  '在每行日志前加上时间前缀，便于定位耗时':
    'Prefix each line with time to locate slow spots',
  '日志文件': 'Log file',
  '可选，将日志同时写入文件': 'Optional; also write logs to a file',
  '高级': 'Advanced',
  '额外参数与启动器行为': 'Extra args and launcher behavior',
  '附加命令行参数': 'Extra CLI arguments',
  '按空格拆分，支持双引号包裹含空格的值；将追加到命令行末尾':
    'Split on spaces; double-quoted values may contain spaces; appended to the command',
  '关闭启动器时终止服务': 'Kill server on launcher exit',
  '关闭后不再保留 llama-server 进程': 'No llama-server process kept after exit',
  '启动后自动打开浏览器': 'Auto-open browser after start',
  '服务就绪后打开 Web UI': 'Open the Web UI when the server is ready',
  '预览完整启动命令': 'Preview full launch command',
  '展开以生成预览': 'Expand to generate preview',
  '例如：--check-tensors --override-kv tokenizer.ggml.add_bos_token=bool:false':
    'e.g. --check-tensors --override-kv tokenizer.ggml.add_bos_token=bool:false',
  // 下拉选项（含中文的标签）
  'auto（自动适配显存）': 'auto (auto-fit VRAM)',
  'all（全部层卸载到 GPU）': 'all (offload all layers to GPU)',
  'custom（自定义层数）': 'custom (custom layer count)',
  'none（仅用一张 GPU）': 'none (single GPU only)',
  'layer（按层流水线切分）': 'layer (pipeline split)',
  'row（按行并行切分）': 'row (row-parallel split)',
  'tensor（按张量切分，实验性）': 'tensor (tensor split, experimental)',
  '（默认，不启用）': '(default, disabled)',
  'none（不扩展）': 'none (no scaling)',
  '0 · 仅通用输出': '0 · common output only',
  '1 · 错误': '1 · errors',
  '2 · 警告': '2 · warnings',
  '3 · 信息（默认）': '3 · info (default)',
  '4 · 追踪': '4 · trace',
  '5 · 调试': '5 · debug',
  // 偏好设置页
  '个性化启动器的语言与外观': 'Personalize the launcher\'s language and appearance',
  '语言': 'Language',
  '选择界面显示语言': 'Choose the UI display language',
  '外观': 'Appearance',
  '选择主题色与明暗模式': 'Choose the theme color and light/dark mode',
  '主题色': 'Theme color',
  '浅色': 'Light',
  '深色': 'Dark',
  // 聊天页
  'AI 聊天': 'AI Chat',
  '发送': 'Send',
  '输入消息…': 'Type a message…',
  '请先在控制台启动服务': 'Start the server from the console first',
  '开始和本地模型对话吧': 'Start chatting with your local model',
  '添加图片': 'Add image',
  '移除图片': 'Remove image',
  '图片预览': 'Image preview',
  '正在生成…': 'Generating…',
  '请求失败': 'Request failed',
  '（模型未返回内容）': '(The model returned no content)',
  // 日志视图
  '暂无日志': 'No logs',
  '[启动器]': '[launcher]',
  // 模型根目录占位
  '模型根目录，例如 D:\\llama.cpp\\model': 'Model root, e.g. D:\\llama.cpp\\model',
}

/** 翻译：zh 返回原文，en 返回 EN 字典（缺失回退中文） */
export function translate(text: string, vars?: Record<string, string | number>): string {
  if (currentResolved === 'zh') return interpolate(text, vars)
  const en = EN[text]
  return interpolate(en ?? text, vars)
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
interface I18nCtx {
  pref: LocalePref
  resolved: ResolvedLocale
  setLocale: (pref: LocalePref) => void
  t: (text: string, vars?: Record<string, string | number>) => string
}

const LocaleContext = React.createContext<I18nCtx | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPref] = React.useState<LocalePref>(() => getStoredLocale())
  const resolved = resolveLocale(pref)

  React.useEffect(() => {
    currentResolved = resolved
    document.documentElement.lang = resolved === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.setAttribute('data-locale', resolved)
  }, [resolved])

  const change = React.useCallback((p: LocalePref) => {
    setLocale(p)
    setPref(p)
  }, [])

  const t = React.useCallback(
    (text: string, vars?: Record<string, string | number>) => translate(text, vars),
    [resolved],
  )

  return (
    <LocaleContext.Provider value={{ pref, resolved, setLocale: change, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useI18n(): I18nCtx {
  const ctx = React.useContext(LocaleContext)
  if (!ctx) throw new Error('useI18n must be used within <LocaleProvider>')
  return ctx
}
