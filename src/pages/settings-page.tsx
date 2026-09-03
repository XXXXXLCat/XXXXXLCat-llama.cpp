import * as React from 'react'
import { ChevronDown, FolderOpen, RotateCcw, Save, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useLauncher } from '@/hooks/use-launcher'
import { api } from '@/lib/tauri-api'
import { useI18n } from '@/lib/i18n'
import type { LaunchConfig } from '@/lib/tauri-api'

// ------------------------------------------------------------- field pieces

function NumberField({
  title,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  title: string
  description?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}) {
  const { t } = useI18n()
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value)
          onChange(Number.isFinite(next) ? next : 0)
        }}
      />
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

function TextField({
  title,
  description,
  value,
  onChange,
  placeholder,
}: {
  title: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const { t } = useI18n()
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

function PathField({
  title,
  description,
  value,
  onChange,
  onBrowse,
}: {
  title: string
  description?: string
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
}) {
  const { t } = useI18n()
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        <Button variant="outline" onClick={onBrowse}>
          <FolderOpen />
          {t('浏览')}
        </Button>
      </div>
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

function SelectField({
  title,
  description,
  value,
  onChange,
  options,
}: {
  title: string
  description?: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  const { t } = useI18n()
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(String(v))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {t(o.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

function ToggleField({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <Field orientation="horizontal">
      <FieldLabel>
        <FieldContent>
          <FieldTitle>{t(title)}</FieldTitle>
          {description && <FieldDescription>{t(description)}</FieldDescription>}
        </FieldContent>
        <Switch checked={checked} onCheckedChange={onChange} />
      </FieldLabel>
    </Field>
  )
}

// ------------------------------------------------------------------- options

const GPU_LAYERS_MODE = [
  { value: 'auto', label: 'auto（自动适配显存）' },
  { value: 'all', label: 'all（全部层卸载到 GPU）' },
  { value: 'custom', label: 'custom（自定义层数）' },
]

const FLASH_ATTN = [
  { value: 'auto', label: 'auto' },
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
]

const SPLIT_MODE = [
  { value: 'none', label: 'none（仅用一张 GPU）' },
  { value: 'layer', label: 'layer（按层流水线切分）' },
  { value: 'row', label: 'row（按行并行切分）' },
  { value: 'tensor', label: 'tensor（按张量切分，实验性）' },
]

const LOAD_MODE = [
  { value: 'auto', label: 'auto' },
  { value: 'none', label: 'none' },
  { value: 'mmap', label: 'mmap' },
  { value: 'mlock', label: 'mlock' },
  { value: 'mmap+mlock', label: 'mmap+mlock' },
  { value: 'dio', label: 'dio' },
]

const CACHE_TYPES = [
  { value: 'f32', label: 'f32' },
  { value: 'f16', label: 'f16' },
  { value: 'bf16', label: 'bf16' },
  { value: 'q8_0', label: 'q8_0' },
  { value: 'q4_0', label: 'q4_0' },
  { value: 'q4_1', label: 'q4_1' },
  { value: 'iq4_nl', label: 'iq4_nl' },
  { value: 'q5_0', label: 'q5_0' },
  { value: 'q5_1', label: 'q5_1' },
]

const NUMA = [
  { value: '', label: '（默认，不启用）' },
  { value: 'distribute', label: 'distribute' },
  { value: 'isolate', label: 'isolate' },
  { value: 'numactl', label: 'numactl' },
]

const ROPE_SCALING = [
  { value: 'none', label: 'none（不扩展）' },
  { value: 'linear', label: 'linear' },
  { value: 'yarn', label: 'yarn' },
]

const VERBOSITY = [
  { value: '0', label: '0 · 仅通用输出' },
  { value: '1', label: '1 · 错误' },
  { value: '2', label: '2 · 警告' },
  { value: '3', label: '3 · 信息（默认）' },
  { value: '4', label: '4 · 追踪' },
  { value: '5', label: '5 · 调试' },
]

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(title)}</CardTitle>
        <CardDescription>{t(description)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 sm:grid-cols-2">{children}</div>
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------------------- page

export function SettingsPage() {
  const { t } = useI18n()
  const { config, dirty, updateConfig, saveConfig, reloadConfig } = useLauncher()
  const [preview, setPreview] = React.useState<string[]>([])

  const set = <K extends keyof LaunchConfig>(key: K) => (value: LaunchConfig[K]) =>
    updateConfig({ [key]: value } as Partial<LaunchConfig>)

  const showPreview = async () => {
    const args = await api.previewCommand(config)
    setPreview(args)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-end gap-3 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="flex items-center gap-1.5 text-sm text-amber-500">
              <span className="size-2 rounded-full bg-amber-500" />
              {t('有更改未保存')}
            </span>
          )}
          <Button variant="outline" onClick={() => void reloadConfig()} disabled={!dirty}>
            <RotateCcw />
            {t('撤销更改')}
          </Button>
          <Button onClick={() => void saveConfig()} disabled={!dirty}>
            <Save />
            {t('保存参数')}
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">

      <Section title="路径" description="llama.cpp 目录与模型文件位置">
        <PathField
          title="llama.cpp 目录"
          description="包含 llama-server.exe 与 ggml/cuda 动态库的目录"
          value={config.llamaDir}
          onChange={set('llamaDir')}
          onBrowse={() => void api.pickDirectory(config.llamaDir).then((p) => p && updateConfig({ llamaDir: p }))}
        />
        <TextField
          title="服务程序"
          description="相对上述目录的文件名，或填写完整绝对路径"
          value={config.serverBin}
          onChange={set('serverBin')}
          placeholder="llama-server.exe"
        />
      </Section>

      <Section title="服务与网络" description="HTTP 服务监听与接口开关">
        <TextField
          title="监听地址"
          description="127.0.0.1 仅本机可访问，0.0.0.0 允许局域网访问（本机打开 Web UI 时会自动改用 127.0.0.1）"
          value={config.host}
          onChange={set('host')}
        />
        <NumberField
          title="端口"
          description="HTTP 服务监听端口，需未被其他程序占用"
          value={config.port}
          onChange={(v) => updateConfig({ port: Math.round(v) })}
          min={1}
          max={65535}
        />
        <NumberField
          title="并行槽位 (-np)"
          description="-1 表示按显存自动决定"
          value={config.parallel}
          onChange={(v) => updateConfig({ parallel: Math.round(v) })}
          min={-1}
        />
        <NumberField
          title="读写超时（秒）"
          description="单个请求的最大等待时间，超时后断开连接"
          value={config.timeout}
          onChange={(v) => updateConfig({ timeout: Math.round(v) })}
          min={1}
        />
        <NumberField
          title="HTTP 线程数"
          description="-1 表示自动"
          value={config.threadsHttp}
          onChange={(v) => updateConfig({ threadsHttp: Math.round(v) })}
          min={-1}
        />
        <TextField
          title="模型别名 (-a)"
          description="API 中显示的模型名称"
          value={config.alias}
          onChange={set('alias')}
        />
        <TextField
          title="API Key"
          description="留空表示不启用鉴权"
          value={config.apiKey}
          onChange={set('apiKey')}
        />
        <ToggleField
          title="连续批处理"
          description="允许多个请求并行解码"
          checked={config.contBatching}
          onChange={(v) => updateConfig({ contBatching: v })}
        />
        <ToggleField
          title="内置 Web UI"
          description="关闭后仅保留 OpenAI 兼容接口，「打开 Web UI」按钮将不可用"
          checked={config.webui}
          onChange={(v) => updateConfig({ webui: v })}
        />
        <ToggleField
          title="槽位监控端点"
          description="开放 /slots 查看各并行槽位的实时占用情况"
          checked={config.slotsEndpoint}
          onChange={(v) => updateConfig({ slotsEndpoint: v })}
        />
        <ToggleField
          title="Prometheus 指标"
          description="开放 /metrics 供监控系统采集吞吐与延迟"
          checked={config.metrics}
          onChange={(v) => updateConfig({ metrics: v })}
        />
        <ToggleField
          title="运行时属性修改 (/props)"
          description="允许通过 API 在不重启服务的情况下调整采样参数"
          checked={config.props}
          onChange={(v) => updateConfig({ props: v })}
        />
        <ToggleField
          title="嵌入模型模式"
          description="仅用于专用嵌入模型，会禁用生成接口"
          checked={config.embedding}
          onChange={(v) => updateConfig({ embedding: v })}
        />
        <ToggleField
          title="Jinja 聊天模板"
          description="使用模型内置模板格式化对话，工具调用需开启"
          checked={config.jinja}
          onChange={(v) => updateConfig({ jinja: v })}
        />
      </Section>

      <Section title="模型与显存" description="层卸载、KV 缓存与多 GPU 切分">
        <SelectField
          title="GPU 层数模式 (-ngl)"
          description="决定多少层权重卸载到显存，卸载越多推理越快"
          value={config.gpuLayersMode}
          onChange={set('gpuLayersMode')}
          options={GPU_LAYERS_MODE}
        />
        <NumberField
          title="自定义 GPU 层数"
          description="仅当模式为 custom 时生效"
          value={config.gpuLayersValue}
          onChange={(v) => updateConfig({ gpuLayersValue: Math.round(v) })}
          min={0}
          disabled={config.gpuLayersMode !== 'custom'}
        />
        <SelectField
          title="Flash Attention"
          description="融合注意力算子，可降低显存并提速；auto 由后端自行判断"
          value={config.flashAttn}
          onChange={set('flashAttn')}
          options={FLASH_ATTN}
        />
        <SelectField
          title="多 GPU 切分模式"
          description="多卡时模型如何拆分到各张卡；单卡请选 none"
          value={config.splitMode}
          onChange={set('splitMode')}
          options={SPLIT_MODE}
        />
        <NumberField
          title="主 GPU 索引"
          description="存放 KV 缓存与中间张量的主卡编号，从 0 开始"
          value={config.mainGpu}
          onChange={(v) => updateConfig({ mainGpu: Math.round(v) })}
          min={0}
        />
        <TextField
          title="张量切分比例 (-ts)"
          description="例如 3,1"
          value={config.tensorSplit}
          onChange={set('tensorSplit')}
          placeholder="留空表示均分"
        />
        <TextField
          title="设备列表 (-dev)"
          description="留空表示使用全部可用设备"
          value={config.device}
          onChange={set('device')}
        />
        <SelectField
          title="模型加载模式 (-lm)"
          description="权重读取方式；mmap 省内存，mlock 锁定物理内存防换页"
          value={config.loadMode}
          onChange={set('loadMode')}
          options={LOAD_MODE}
        />
        <SelectField
          title="NUMA 策略"
          description="多路 CPU 的内存亲和性优化，单路机器保持默认"
          value={config.numa}
          onChange={set('numa')}
          options={NUMA}
        />
        <SelectField
          title="K 缓存数据类型 (-ctk)"
          description="Key 缓存量化精度，降低精度可显著节省显存"
          value={config.cacheTypeK}
          onChange={set('cacheTypeK')}
          options={CACHE_TYPES}
        />
        <SelectField
          title="V 缓存数据类型 (-ctv)"
          description="Value 缓存量化精度，通常与 K 缓存保持一致"
          value={config.cacheTypeV}
          onChange={set('cacheTypeV')}
          options={CACHE_TYPES}
        />
        <ToggleField
          title="KV 缓存卸载到 GPU"
          description="关闭后 KV 缓存留在内存，省显存但会降速"
          checked={config.kvOffload}
          onChange={(v) => updateConfig({ kvOffload: v })}
        />
      </Section>

      <Section title="上下文与批处理" description="显存占用的主要来源">
        <NumberField
          title="上下文长度 (-c)"
          description="0 表示使用模型训练上下文"
          value={config.ctxSize}
          onChange={(v) => updateConfig({ ctxSize: Math.round(v) })}
          min={0}
        />
        <NumberField
          title="逻辑批处理大小 (-b)"
          description="一次提交给后端的最大 token 数，影响预填充吞吐"
          value={config.batchSize}
          onChange={(v) => updateConfig({ batchSize: Math.round(v) })}
          min={1}
        />
        <NumberField
          title="物理批处理大小 (-ub)"
          description="单次实际计算的 token 数，需不大于逻辑批处理大小"
          value={config.ubatchSize}
          onChange={(v) => updateConfig({ ubatchSize: Math.round(v) })}
          min={1}
        />
        <NumberField
          title="生成线程数 (-t)"
          description="-1 表示自动"
          value={config.threads}
          onChange={(v) => updateConfig({ threads: Math.round(v) })}
          min={-1}
        />
        <NumberField
          title="批处理线程数 (-tb)"
          description="-1 表示与生成线程一致"
          value={config.threadsBatch}
          onChange={(v) => updateConfig({ threadsBatch: Math.round(v) })}
          min={-1}
        />
        <NumberField
          title="最大生成长度 (-n)"
          description="-1 表示不限制"
          value={config.nPredict}
          onChange={(v) => updateConfig({ nPredict: Math.round(v) })}
          min={-1}
        />
      </Section>

      <Section title="采样参数" description="服务端默认采样行为，可被请求参数覆盖">
        <NumberField
          title="Temperature"
          description="采样温度，越大越随机；0 表示贪心解码"
          value={config.temperature}
          onChange={(v) => updateConfig({ temperature: v })}
          min={0}
          max={2}
          step={0.01}
        />
        <NumberField
          title="Top-P"
          description="核采样阈值，仅从累积概率前 P 的候选中取样；1 表示禁用"
          value={config.topP}
          onChange={(v) => updateConfig({ topP: v })}
          min={0}
          max={1}
          step={0.01}
        />
        <NumberField
          title="Top-K"
          description="仅保留概率最高的 K 个候选；0 表示禁用"
          value={config.topK}
          onChange={(v) => updateConfig({ topK: Math.round(v) })}
          min={0}
        />
        <NumberField
          title="Min-P"
          description="按最高概率的相对比例过滤低概率候选；0 表示禁用"
          value={config.minP}
          onChange={(v) => updateConfig({ minP: v })}
          min={0}
          max={1}
          step={0.01}
        />
        <NumberField
          title="重复惩罚"
          description="对已出现过的 token 降权，1 表示不惩罚"
          value={config.repeatPenalty}
          onChange={(v) => updateConfig({ repeatPenalty: v })}
          min={1}
          max={2}
          step={0.01}
        />
        <NumberField
          title="重复回看长度"
          description="参与重复惩罚统计的最近 token 数；0 表示禁用"
          value={config.repeatLastN}
          onChange={(v) => updateConfig({ repeatLastN: Math.round(v) })}
          min={0}
        />
        <NumberField
          title="存在惩罚"
          description="对出现过的 token 施加固定惩罚，抑制复述；0 表示禁用"
          value={config.presencePenalty}
          onChange={(v) => updateConfig({ presencePenalty: v })}
          min={-2}
          max={2}
          step={0.01}
        />
        <NumberField
          title="频率惩罚"
          description="按出现次数递增惩罚，抑制高频词刷屏；0 表示禁用"
          value={config.frequencyPenalty}
          onChange={(v) => updateConfig({ frequencyPenalty: v })}
          min={-2}
          max={2}
          step={0.01}
        />
        <NumberField
          title="随机种子 (-s)"
          description="-1 表示每次随机"
          value={config.seed}
          onChange={(v) => updateConfig({ seed: Math.round(v) })}
          min={-1}
        />
      </Section>

      <Section title="RoPE 与多模态" description="长上下文扩展与视觉投影卸载">
        <SelectField
          title="RoPE 缩放方式"
          description="位置编码外推算法，用于超出模型训练长度的上下文"
          value={config.ropeScaling}
          onChange={set('ropeScaling')}
          options={ROPE_SCALING}
        />
        <NumberField
          title="RoPE 缩放因子"
          description="仅在启用缩放时生效"
          value={config.ropeScale}
          onChange={(v) => updateConfig({ ropeScale: v })}
          min={1}
          step={0.25}
        />
        <NumberField
          title="YaRN 原始上下文"
          description="0 表示使用模型训练上下文"
          value={config.yarnOrigCtx}
          onChange={(v) => updateConfig({ yarnOrigCtx: Math.round(v) })}
          min={0}
        />
        <ToggleField
          title="视觉投影卸载到 GPU"
          description="关闭后 mmproj 在 CPU 上推理"
          checked={config.mmprojOffload}
          onChange={(v) => updateConfig({ mmprojOffload: v })}
        />
        <TextField
          title="视觉投影设备 (-mmdev)"
          description="留空表示跟随主设备；填 none 表示不卸载"
          value={config.mmprojDevice}
          onChange={set('mmprojDevice')}
        />
      </Section>

      <Section title="日志" description="输出到启动器日志窗口的详细程度">
        <SelectField
          title="日志级别 (-lv)"
          description="级别越高输出越详细，排查问题时可调至追踪或调试"
          value={String(config.verbosity)}
          onChange={(v) => updateConfig({ verbosity: Number(v) })}
          options={VERBOSITY}
        />
        <ToggleField
          title="日志时间戳"
          description="在每行日志前加上时间前缀，便于定位耗时"
          checked={config.logTimestamps}
          onChange={(v) => updateConfig({ logTimestamps: v })}
        />
        <PathField
          title="日志文件"
          description="可选，将日志同时写入文件"
          value={config.logFile}
          onChange={set('logFile')}
          onBrowse={() => void api.pickDirectory(config.llamaDir).then((p) => p && updateConfig({ logFile: `${p}\\llama-server.log` }))}
        />
      </Section>

      <Card>
        <CardHeader>
          <CardTitle>{t('高级')}</CardTitle>
          <CardDescription>{t('额外参数与启动器行为')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldTitle>{t('附加命令行参数')}</FieldTitle>
            <Textarea
              value={config.extraArgs}
              onChange={(e) => updateConfig({ extraArgs: e.target.value })}
              placeholder={t('例如：--check-tensors --override-kv tokenizer.ggml.add_bos_token=bool:false')}
              className="min-h-20 font-mono"
            />
            <FieldDescription>
              {t('按空格拆分，支持双引号包裹含空格的值；将追加到命令行末尾')}
            </FieldDescription>
          </Field>

          <Separator />

          <div className="grid gap-5 sm:grid-cols-2">
            <ToggleField
              title="关闭启动器时终止服务"
              description="关闭后不再保留 llama-server 进程"
              checked={config.killOnExit}
              onChange={(v) => updateConfig({ killOnExit: v })}
            />
            <ToggleField
              title="启动后自动打开浏览器"
              description="服务就绪后打开 Web UI"
              checked={config.autoOpenBrowser}
              onChange={(v) => updateConfig({ autoOpenBrowser: v })}
            />
          </div>

          <Separator />

          <Collapsible onOpenChange={(open) => open && void showPreview()}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
              <Terminal />
              {t('预览完整启动命令')}
              <ChevronDown className="data-[open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                {preview.length > 0 ? preview.join(' ') : t('展开以生成预览')}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
      </div>
      </ScrollArea>
    </div>
  )
}
