import * as React from 'react'
import {
  ChevronDown,
  FolderOpen,
  RotateCcw,
  Save,
  Search,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useLauncher } from '@/hooks/use-launcher'
import { api } from '@/lib/tauri-api'
import { useI18n, translateEn } from '@/lib/i18n'
import { DEFAULT_CONFIG } from '@/lib/tauri-mock'
import { MANAGED_PARAM_KEYS } from '@/lib/model-presets'
import type { LaunchConfig } from '@/lib/tauri-api'

// --------------------------------------------------------- search context
// 顶栏搜索框通过 Context 把 query 下发给每个字段组件与 Section：
// 字段组件据此判断是否渲染（不匹配则 null），Section 据此判断是否整块隐藏。
// 这样无需逐字段透传 query prop，新增字段也能自动获得搜索能力。
const SearchContext = React.createContext<{ query: string }>({ query: '' })
function useSearch() {
  return React.useContext(SearchContext)
}

/** 大小写不敏感的子串匹配。query 为空时恒为 true（显示全部）。 */
function fieldMatches(query: string, parts: string[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return parts.join(' ').toLowerCase().includes(q)
}

/** 结构化深比较（仅用于 LaunchConfig 这类纯数据对象）。用于判断草稿是否真的
 * 偏离了已保存配置——避免「改了又改回去」仍被判定为「有更改未保存」。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false
      }
    }
    return true
  }
  return false
}

// ------------------------------------------------------------- field pieces

/**
 * 数值参数。`value === null` 表示「未设置」：输入框留空、以灰色占位提示
 * llama-server 的默认值，启动时该参数完全不下发。
 */
function NumberField({
  title,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  defaultValue,
}: {
  title: string
  description?: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** llama-server 的默认值，留空时以灰色占位显示。 */
  defaultValue?: string
}) {
  const { t } = useI18n()
  const { query } = useSearch()
  const id = React.useId()
  if (!fieldMatches(query, [title, t(title), description ? t(description) : '', String(value ?? '')])) {
    return null
  }
  return (
    <Field data-field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={defaultValue ? translateEn('common.defaultHint', { v: defaultValue }) : undefined}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            onChange(null)
            return
          }
          const next = Number(raw)
          onChange(Number.isFinite(next) ? next : null)
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
  const { query } = useSearch()
  const id = React.useId()
  if (!fieldMatches(query, [title, t(title), description ? t(description) : '', value])) {
    return null
  }
  // 空值占位：与 NumberField 保持一致，统一显示为灰色「默认：XXX」。
  // placeholder 传入的可能是 i18n key（如 'settings.rpcHint'，需翻译）或字面量
  // （如 '1024'，translate 缺失时原样回退），统一经 defaultHint 包成「默认：XXX」。
  const ph = placeholder ? translateEn('common.defaultHint', { v: translateEn(placeholder) }) : undefined
  return (
    <Field data-field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={ph}
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
  const { query } = useSearch()
  const id = React.useId()
  if (!fieldMatches(query, [title, t(title), description ? t(description) : '', value])) {
    return null
  }
  return (
    <Field data-field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        <Button variant="outline" onClick={onBrowse}>
          <FolderOpen />
          {t('common.browse')}
        </Button>
      </div>
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

/**
 * 下拉参数。语义统一为：
 *   - 选 **Default**（或输入框留空）= 未设置 → 该参数完全不下发，由 llama-server 取自身默认；
 *   - 选中任何具体值 = 显式下发该参数。
 * 因此 `options` **只允许放 llama.cpp 真实支持的参数值**，不得塞入 auto / 空串之类的哨兵项，
 * 那些语义一律由 Default 项承担。
 */
/** 下拉里代表「未设置」的内部标记值，不会作为参数下发。 */
const UNSET = '__unset__'

function SelectField({
  title,
  description,
  value,
  onChange,
  options,
  unsetValue,
}: {
  title: string
  description?: string
  /** null = 未设置（不下发）。 */
  value: string | null
  onChange: (value: string | null) => void
  options: Array<{ value: string; label: string }>
  /**
   * 非空 string 字段用某个具体值表示「不下发」（`numa=''`、`ropeScaling=''`、`gpuLayersMode=''`
   * 等空串皆是如此）。传入该值后，Default 项会被判定为选中；可不传（可空字段直接用 null）。
   * 注意：这些字段的默认值在 DEFAULT_CONFIG / LaunchConfig::default() 里就是对应的空串，
   * 因此「恢复默认」后下拉框一律显示「默认」，而 server.rs 仍按 `_ => "auto"` / 空串跳过
   * 的规则正确下发（如 -ngl auto 始终下发，避免退回全 CPU 推理）。
   */
  unsetValue?: string
}) {
  const { t } = useI18n()
  const { query } = useSearch()
  const id = React.useId()
  const optParts = options.flatMap((o) => [o.value, translateEn(o.label)])
  if (!fieldMatches(query, [title, t(title), description ? t(description) : '', value ?? '', ...optParts])) {
    return null
  }
  const isUnset = value === null || (unsetValue !== undefined && value === unsetValue)
  return (
    <Field data-field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Select
        value={isUnset ? UNSET : (value ?? UNSET)}
        onValueChange={(v) => onChange(v === UNSET ? null : String(v))}
      >
        <SelectTrigger id={id} className="w-full">
          {/* 显式计算展示文本：下拉关闭时 SelectContent 未挂载、items 为空，
              Base UI 的 SelectValue 会把 value 原样吐出（即 '__unset__'）。
              显式传 children 可彻底绕过该解析回退。 */}
          <SelectValue>
            {isUnset
              ? t('common.defaultSelect')
              : (() => {
                  const o = options.find((x) => x.value === value)
                  return o ? translateEn(o.label) : (value ?? '')
                })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* Default 单独一行，与真实参数值用分隔线隔开，避免被误当成某个参数值 */}
          <SelectItem value={UNSET}>{t('common.defaultSelect')}</SelectItem>
          <SelectSeparator />
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {translateEn(o.label)}
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
  const { query } = useSearch()
  const id = React.useId()
  if (!fieldMatches(query, [title, t(title), description ? t(description) : ''])) {
    return null
  }
  return (
    <Field data-field orientation="horizontal">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
        {description && <FieldDescription>{t(description)}</FieldDescription>}
      </FieldContent>
    </Field>
  )
}

function BoolTriStateField({
  title,
  description,
  value,
  onChange,
}: {
  title: string
  description?: string
  /** null = 未设置（auto，不下发）；true = 开；false = 关 */
  value: boolean | null
  onChange: (value: boolean | null) => void
}) {
  const { t } = useI18n()
  const { query } = useSearch()
  const id = React.useId()
  if (!fieldMatches(query, [title, t(title), description ? t(description) : ''])) {
    return null
  }
  return (
    <Field data-field>
      <FieldLabel htmlFor={id}>{t(title)}</FieldLabel>
      <Select
        value={value === null ? 'auto' : value === true ? 'on' : 'off'}
        onValueChange={(v) =>
          onChange(v === 'auto' ? null : v === 'on' ? true : false)
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            {value === null
              ? t('common.defaultSelect')
              : value
                ? t('common.on')
                : t('common.off')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* Default（auto）单独一行，与 on/off 用分隔线隔开，和 SelectField 保持一致 */}
          <SelectItem value="auto">{t('common.defaultSelect')}</SelectItem>
          <SelectSeparator />
          <SelectItem value="on">{t('common.on')}</SelectItem>
          <SelectItem value="off">{t('common.off')}</SelectItem>
        </SelectContent>
      </Select>
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

// ------------------------------------------------------------------- options

// -ngl 是本项目核心能力、始终下发，故「不传」对应内部值 auto，由 Default 项承担，
// 不再单列 auto 选项，避免出现 Default 与 auto 两个语义重复的条目。
const GPU_LAYERS_MODE = [
  { value: 'auto', label: 'opt.gpuLayers.auto' },
  { value: 'all', label: 'opt.gpuLayers.all' },
  { value: 'custom', label: 'opt.gpuLayers.custom' },
]

const LOG_COLORS = [
  { value: 'on', label: 'opt.logColors.on' },
  { value: 'off', label: 'opt.logColors.off' },
  { value: 'auto', label: 'opt.logColors.auto' },
]

const FLASH_ATTN = [
  { value: 'auto', label: 'opt.auto' },
  { value: 'on', label: 'opt.flashAttn.on' },
  { value: 'off', label: 'opt.flashAttn.off' },
]

const SPLIT_MODE = [
  { value: 'none', label: 'opt.multiGpu.none' },
  { value: 'layer', label: 'opt.multiGpu.layer' },
  { value: 'row', label: 'opt.multiGpu.row' },
  { value: 'tensor', label: 'opt.multiGpu.tensor' },
]

const LOAD_MODE = [
  { value: 'auto', label: 'opt.auto' },
  { value: 'none', label: 'opt.none' },
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
  { value: 'distribute', label: 'distribute' },
  { value: 'isolate', label: 'isolate' },
  { value: 'numactl', label: 'numactl' },
]

const ROPE_SCALING = [
  { value: 'none', label: 'none' },
  { value: 'linear', label: 'linear' },
  { value: 'yarn', label: 'yarn' },
]

const VERBOSITY = [
  { value: '0', label: 'opt.verbosity.0' },
  { value: '1', label: 'opt.verbosity.1' },
  { value: '2', label: 'opt.verbosity.2' },
  { value: '3', label: 'opt.verbosity.3' },
  { value: '4', label: 'opt.verbosity.4' },
  { value: '5', label: 'opt.verbosity.5' },
]

const LAZY_MODE = [
  { value: 'auto', label: 'opt.auto' },
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
]

const ON_OFF_01 = [
  { value: '0', label: 'opt.off' },
  { value: '1', label: 'opt.on' },
]

const PRIO = [
  { value: '-1', label: 'opt.prio.low' },
  { value: '0', label: 'opt.prio.normal' },
  { value: '1', label: 'opt.prio.medium' },
  { value: '2', label: 'opt.prio.high' },
  { value: '3', label: 'opt.prio.realtime' },
]

const MIROSTAT = [
  { value: '0', label: 'opt.mirostat.off' },
  { value: '1', label: 'opt.mirostat.v1' },
  { value: '2', label: 'opt.mirostat.v2' },
]

const SPEC_TYPE = [
  { value: 'none', label: 'none' },
  { value: 'draft-simple', label: 'draft-simple' },
  { value: 'draft-eagle3', label: 'draft-eagle3' },
  { value: 'draft-mtp', label: 'draft-mtp' },
  { value: 'draft-dflash', label: 'draft-dflash' },
  { value: 'draft-dspark', label: 'draft-dspark' },
  { value: 'ngram-simple', label: 'ngram-simple' },
  { value: 'ngram-map-k', label: 'ngram-map-k' },
  { value: 'ngram-map-k4v', label: 'ngram-map-k4v' },
  { value: 'ngram-mod', label: 'ngram-mod' },
  { value: 'ngram-cache', label: 'ngram-cache' },
]

const REASONING = [
  { value: 'auto', label: 'opt.auto' },
  { value: 'on', label: 'opt.on' },
  { value: 'off', label: 'opt.off' },
]

const REASONING_FORMAT = [
  { value: 'none', label: 'none' },
  { value: 'deepseek', label: 'deepseek' },
  { value: 'deepseek-legacy', label: 'deepseek-legacy' },
]

const REASONING_EFFORT = [
  { value: 'default', label: 'default' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
]

const POOLING = [
  { value: 'none', label: 'none' },
  { value: 'mean', label: 'mean' },
  { value: 'cls', label: 'cls' },
  { value: 'last', label: 'last' },
  { value: 'rank', label: 'rank' },
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
  const { query } = useSearch()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(true)
  const q = query.trim()
  // 搜索态下：字段组件会自行把不匹配项渲染为 null（不再挂 [data-field]），
  // 故统计内容区内剩余 [data-field] 数量即可判断本 Section 是否还应显示。
  React.useLayoutEffect(() => {
    if (!q) {
      setVisible(true)
      return
    }
    const count = contentRef.current
      ? contentRef.current.querySelectorAll('[data-field]').length
      : 0
    setVisible(count > 0)
  }, [q, children])
  if (!visible) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(title)}</CardTitle>
        <CardDescription>{t(description)}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* 与控制台页内部字段网格一致：列间距 gap-x-8、2 列；
            [&>*]:min-w-0 让每个字段可收缩到栅格列宽，避免长标签/下拉把
            内容撑宽后被 Card 的 overflow-hidden 裁掉（即「旁边被遮盖」）。 */}
        <div ref={contentRef} className="grid gap-x-8 gap-y-5 sm:grid-cols-2 [&>*]:min-w-0">
          {children}
        </div>
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------------------- page

export function SettingsPage() {
  const { t } = useI18n()
  // 全局 config 是控制台实时生效的那一份。本页所有编辑只落在 hook 层的
  // settingsDraft 上，点「保存」才提交——这样本页未保存的改动不可能被控制台
  // 的自动落盘捎带写入；且草稿挂在 Provider 上，切换页面（本页卸载/重挂）
  // 后编辑仍保留。
  const {
    config: savedConfig,
    settingsDraft,
    setSettingsDraft,
    commitConfig,
    reloadConfig,
  } = useLauncher()
  const [preview, setPreview] = React.useState<string[]>([])
  const [saveError, setSaveError] = React.useState<string | null>(null)
  // 顶栏搜索：过滤下方参数列表。空串表示不过滤（显示全部）。
  const [query, setQuery] = React.useState('')

  // 草稿为 null 表示无未保存编辑，直接展示已提交的 config；否则展示草稿。
  const draft = settingsDraft ?? savedConfig
  // 包装一次：首 editing 时 settingsDraft 仍为 null，以 savedConfig 兜底，
  // 避免 {...null} 把整个对象清空。下方所有字段绑定沿用此签名，无需逐处处理 null。
  // 同时按「前后值差异」把被改动的受管参数记入 manualParams：之后换模型触发
  // 自动推荐时会跳过这些键，不覆盖用户的手动设置。若 updater 显式改写了
  // manualParams（如「恢复默认值」），则以其为准，不再合并。
  const setDraft = (updater: (prev: LaunchConfig) => LaunchConfig) =>
    setSettingsDraft((prev) => {
      const base = prev ?? savedConfig
      const next = updater(base)
      if (next.manualParams !== base.manualParams) return next
      const changed = MANAGED_PARAM_KEYS.filter((k) => next[k] !== base[k])
      if (changed.length === 0) return next
      const manual = new Set(base.manualParams ?? [])
      for (const k of changed) manual.add(k)
      const merged = Array.from(manual)
      const before = base.manualParams ?? []
      if (merged.length === before.length && merged.every((k) => before.includes(k))) {
        return next
      }
      return { ...next, manualParams: merged }
    })

  const set = <K extends keyof LaunchConfig>(key: K) => (value: LaunchConfig[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  // 本页自己的「未保存」：草稿与已保存配置**逐值不同**才算有改动。仅判断
  // `settingsDraft !== null` 会在「改了又改回原值」时仍误报未保存（草稿对象
  // 已存在），故需与 savedConfig 深比较；相等即视为无更改。
  const dirty = settingsDraft !== null && !deepEqual(settingsDraft, savedConfig)

  const save = async () => {
    if (!settingsDraft) return
    setSaveError(null)
    try {
      await commitConfig(settingsDraft)
      setSettingsDraft(null)
    } catch (e) {
      setSaveError(String(e))
    }
  }

  const revert = async () => {
    setSaveError(null)
    await reloadConfig()
    setSettingsDraft(null)
  }

  // 恢复为 llama.cpp 源码默认值：保留用户已选模型/路径，其余可调参数整体回到
  // `DEFAULT_CONFIG`（与 `LaunchConfig::default()` 一致）。只写草稿，需点「保存参数」才生效。
  const restoreDefaults = () => {
    setSaveError(null)
    setSettingsDraft((prev) => {
      const base = prev ?? savedConfig
      const {
        llamaDir,
        serverBin,
        modelRoot,
        modelPath,
        mmprojPath,
        autoMmproj,
        draftModelPath,
        autoDraft,
      } = base
      return {
        ...DEFAULT_CONFIG,
        llamaDir,
        serverBin,
        modelRoot,
        modelPath,
        mmprojPath,
        autoMmproj,
        draftModelPath,
        autoDraft,
      }
    })
  }

  const showPreview = async () => {
    const args = await api.previewCommand(draft)
    setPreview(args)
  }

  // 整数字段统一取整；浮点字段保留原值；三态字段原样存 null / true / false。
  const setInt = <K extends keyof LaunchConfig>(key: K) => (v: number | null) =>
    setDraft(
      (prev) => ({ ...prev, [key]: v === null ? null : Math.round(v) }) as LaunchConfig,
    )
  const setNum = <K extends keyof LaunchConfig>(key: K) => (v: number | null) =>
    setDraft((prev) => ({ ...prev, [key]: v }) as LaunchConfig)
  const setTri = <K extends keyof LaunchConfig>(key: K) => (v: boolean | null) =>
    setDraft((prev) => ({ ...prev, [key]: v }) as LaunchConfig)

  return (
    <SearchContext.Provider value={{ query }}>
      <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={restoreDefaults}>
            <RotateCcw />
            {t('common.restoreDefaults')}
          </Button>
          {/* 顶栏搜索：过滤下方参数列表，未匹配的字段与空 Section 自动隐藏 */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.searchPlaceholder')}
              className="pl-8 pr-7"
              aria-label={t('settings.searchPlaceholder')}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t('common.clear')}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="flex items-center gap-1.5 text-sm text-amber-500">
              <span className="size-2 rounded-full bg-amber-500" />
              {t('common.unsaved')}
            </span>
          )}
          <Button variant="outline" onClick={() => void revert()} disabled={!dirty}>
            <RotateCcw />
            {t('common.revert')}
          </Button>
          <Button onClick={() => void save()} disabled={!dirty}>
            <Save />
            {t('common.save')}
          </Button>
        </div>
      </header>
      {/* 直接套用控制台页的结构：外层只负责纵向滚动（overflow-y-auto），
          padding 与卡片间距交给内层 content 块。切勿在此加 overflow-hidden，
          否则卡片右侧会被裁掉（「旁边被遮盖」的根因）。 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          {saveError && (
            <Alert variant="destructive" className="shrink-0">
              <TriangleAlert />
              <AlertTitle>{t('common.failed')}</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">{saveError}</AlertDescription>
            </Alert>
          )}
          {/* block 布局 + space-y：卡片高度由内容决定，不会被 flex 压缩，
            超出容器高度时才出现系统原生滚动条。切勿改成 flex-col（会把卡片压扁、吃掉滚动条）。 */}
          <div className="space-y-3">
<Section title="settings.serverNet" description="settings.serverNetDesc">
            <NumberField
              title="settings.parallelSlots"
              description="settings.parallelSlotsDesc"
              value={draft.parallel}
              onChange={setInt('parallel')}
              min={-1}
              defaultValue="-1"
            />
            <NumberField
              title="settings.readWriteTimeout"
              description="settings.readWriteTimeoutDesc"
              value={draft.timeout}
              onChange={setInt('timeout')}
              min={1}
              defaultValue="3600"
            />
            <NumberField
              title="settings.httpThreads"
              description="settings.httpThreadsDesc"
              value={draft.threadsHttp}
              onChange={setInt('threadsHttp')}
              min={-1}
              defaultValue="-1"
            />
            <TextField
              title="settings.modelAlias"
              description="settings.modelAliasDesc"
              value={draft.alias}
              onChange={set('alias')}
            />
            <BoolTriStateField
              title="console.continuousBatching"
              description="settings.enableParallel"
              value={draft.contBatching}
              onChange={setTri('contBatching')}
            />
            <BoolTriStateField
              title="settings.webui"
              description="settings.disableWebuiDesc"
              value={draft.webui}
              onChange={setTri('webui')}
            />
            <BoolTriStateField
              title="settings.slotsEndpoint"
              description="settings.slotsEndpointDesc"
              value={draft.slotsEndpoint}
              onChange={setTri('slotsEndpoint')}
            />
            <BoolTriStateField
              title="settings.prometheus"
              description="settings.prometheusDesc"
              value={draft.metrics}
              onChange={setTri('metrics')}
            />
            <BoolTriStateField
              title="settings.props"
              description="settings.propsDesc"
              value={draft.props}
              onChange={setTri('props')}
            />
            <BoolTriStateField
              title="settings.embedding"
              description="settings.embeddingDesc"
              value={draft.embedding}
              onChange={setTri('embedding')}
            />
            <BoolTriStateField
              title="settings.jinja"
              description="settings.jinjaDesc"
              value={draft.jinja}
              onChange={setTri('jinja')}
            />
          </Section>
<Section title="settings.modelVram" description="settings.modelVramDesc">
            <SelectField
              title="settings.gpuLayersMode"
              description="settings.gpuLayersModeDesc"
              value={draft.gpuLayersMode}
              onChange={(v) => set('gpuLayersMode')(v ?? '')}
              unsetValue=""
              options={GPU_LAYERS_MODE}
            />
            <NumberField
              title="settings.customGpuLayers"
              description="settings.customGpuLayersDesc"
              value={draft.gpuLayersValue === 999 ? null : draft.gpuLayersValue}
              onChange={setInt('gpuLayersValue')}
              min={0}
              disabled={draft.gpuLayersMode !== 'custom'}
              defaultValue="999"
            />
            <SelectField
              title="Flash Attention"
              description="settings.fusedAttn"
              value={draft.flashAttn}
              onChange={set('flashAttn')}
              options={FLASH_ATTN}
            />
            <SelectField
              title="settings.multiGpuSplit"
              description="settings.multiGpuSplitDesc"
              value={draft.splitMode}
              onChange={set('splitMode')}
              options={SPLIT_MODE}
            />
            <NumberField
              title="settings.mainGpu"
              description="settings.mainGpuDesc"
              value={draft.mainGpu}
              onChange={setInt('mainGpu')}
              min={0}
              defaultValue="0"
            />
            <TextField
              title="settings.tensorSplit"
              description="opt.tensorSplit.example"
              value={draft.tensorSplit}
              onChange={set('tensorSplit')}
              placeholder="settings.tensorSplitDesc"
            />
            <TextField
              title="settings.deviceList"
              description="settings.deviceListDesc"
              value={draft.device}
              onChange={set('device')}
            />
            <SelectField
              title="settings.loadMode"
              description="settings.loadModeDesc"
              value={draft.loadMode}
              onChange={set('loadMode')}
              options={LOAD_MODE}
            />
            <SelectField
              title="settings.numa"
              description="settings.numaDesc"
              value={draft.numa}
              onChange={(v) => set('numa')(v ?? '')}
              unsetValue=""
              options={NUMA}
            />
            <SelectField
              title="settings.kCacheType"
              description="settings.kCacheTypeDesc"
              value={draft.cacheTypeK}
              onChange={set('cacheTypeK')}
              options={CACHE_TYPES}
            />
            <SelectField
              title="settings.vCacheType"
              description="settings.vCacheTypeDesc"
              value={draft.cacheTypeV}
              onChange={set('cacheTypeV')}
              options={CACHE_TYPES}
            />
            <BoolTriStateField
              title="settings.offloadKvGpu"
              description="settings.offloadKvGpuDesc"
              value={draft.kvOffload}
              onChange={setTri('kvOffload')}
            />
            <PathField
              title="settings.lora"
              description="settings.loraDesc"
              value={draft.lora}
              onChange={set('lora')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, lora: p })))
              }
            />
            <BoolTriStateField
              title="settings.cachePrompt"
              description="settings.cachePromptDesc"
              value={draft.cachePrompt}
              onChange={setTri('cachePrompt')}
            />
            <NumberField
              title="settings.cacheReuse"
              description="settings.cacheReuseDesc"
              value={draft.cacheReuse}
              onChange={setInt('cacheReuse')}
              min={0}
              defaultValue="0"
            />
            <BoolTriStateField
              title="settings.cpuMoe"
              description="settings.cpuMoeDesc"
              value={draft.cpuMoe}
              onChange={setTri('cpuMoe')}
            />
            <NumberField
              title="settings.nCpuMoe"
              description="settings.nCpuMoeDesc"
              value={draft.nCpuMoe}
              onChange={setInt('nCpuMoe')}
              min={0}
              defaultValue="0"
            />
            <NumberField
              title="settings.nCpuFfn"
              description="settings.nCpuFfnDesc"
              value={draft.nCpuFfn}
              onChange={setInt('nCpuFfn')}
              min={0}
              defaultValue="0"
            />
            <NumberField
              title="settings.imageMinTokens"
              description="settings.imageMinTokensDesc"
              value={draft.imageMinTokens}
              onChange={setInt('imageMinTokens')}
              min={0}
              defaultValue={translateEn('common.defaultFromModel')}
            />
            <NumberField
              title="settings.imageMaxTokens"
              description="settings.imageMaxTokensDesc"
              value={draft.imageMaxTokens}
              onChange={setInt('imageMaxTokens')}
              min={0}
              defaultValue={translateEn('common.defaultFromModel')}
            />
          </Section>
<Section title="settings.mm" description="settings.mmDesc">
            <BoolTriStateField
              title="settings.mmprojAuto"
              description="settings.mmprojAutoDesc"
              value={draft.mmprojAuto}
              onChange={setTri('mmprojAuto')}
            />
            <TextField
              title="settings.mmprojUrl"
              description="settings.mmprojUrlDesc"
              value={draft.mmprojUrl}
              onChange={set('mmprojUrl')}
            />
            <BoolTriStateField
              title="settings.visionOffloadGpu"
              description="settings.mmprojCpu"
              value={draft.mmprojOffload}
              onChange={setTri('mmprojOffload')}
            />
            <TextField
              title="settings.visionDevice"
              description="settings.visionDeviceDesc"
              value={draft.mmprojDevice}
              onChange={set('mmprojDevice')}
            />
            <NumberField
              title="settings.mtmdBatchMaxTokens"
              description="settings.mtmdBatchMaxTokensDesc"
              value={draft.mtmdBatchMaxTokens}
              onChange={setInt('mtmdBatchMaxTokens')}
              min={0}
              defaultValue="1024"
            />
          </Section>
<Section title="settings.video" description="settings.videoDesc">
            <NumberField
              title="settings.videoFps"
              description="settings.videoFpsDesc"
              value={draft.videoFps}
              onChange={setNum('videoFps')}
              min={0}
              step={0.5}
              defaultValue="4"
            />
            <NumberField
              title="settings.videoTimestampInterval"
              description="settings.videoTimestampIntervalDesc"
              value={draft.videoTimestampInterval}
              onChange={setInt('videoTimestampInterval')}
              min={0}
              defaultValue="5000"
            />
            <PathField
              title="settings.videoFfmpegDir"
              description="settings.videoFfmpegDirDesc"
              value={draft.videoFfmpegDir}
              onChange={set('videoFfmpegDir')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, videoFfmpegDir: p })))
              }
            />
          </Section>
<Section title="settings.adapters" description="settings.adaptersDesc">
            <TextField
              title="settings.loraScaled"
              description="settings.loraScaledDesc"
              value={draft.loraScaled}
              onChange={set('loraScaled')}
              placeholder="settings.loraScaledHint"
            />
            <BoolTriStateField
              title="settings.loraInitWithoutApply"
              description="settings.loraInitWithoutApplyDesc"
              value={draft.loraInitWithoutApply}
              onChange={setTri('loraInitWithoutApply')}
            />
            <PathField
              title="settings.controlVector"
              description="settings.controlVectorDesc"
              value={draft.controlVector}
              onChange={set('controlVector')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, controlVector: p })))
              }
            />
            <TextField
              title="settings.controlVectorScaled"
              description="settings.controlVectorScaledDesc"
              value={draft.controlVectorScaled}
              onChange={set('controlVectorScaled')}
              placeholder="settings.controlVectorScaledHint"
            />
            <TextField
              title="settings.controlVectorLayerRange"
              description="settings.controlVectorLayerRangeDesc"
              value={draft.controlVectorLayerRange}
              onChange={set('controlVectorLayerRange')}
              placeholder="settings.controlVectorLayerRangeHint"
            />
          </Section>
<Section title="settings.tensor" description="settings.tensorDesc">
            <TextField
              title="settings.overrideTensor"
              description="settings.overrideTensorDesc"
              value={draft.overrideTensor}
              onChange={set('overrideTensor')}
              placeholder="settings.overrideTensorHint"
            />
            <TextField
              title="settings.overrideKv"
              description="settings.overrideKvDesc"
              value={draft.overrideKv}
              onChange={set('overrideKv')}
              placeholder="settings.overrideKvHint"
            />
            <SelectField
              title="settings.lazyMode"
              description="settings.lazyModeDesc"
              value={draft.lazyMode}
              onChange={set('lazyMode')}
              options={LAZY_MODE}
            />
            <BoolTriStateField
              title="settings.repack"
              description="settings.repackDesc"
              value={draft.repack}
              onChange={setTri('repack')}
            />
            <BoolTriStateField
              title="settings.opOffload"
              description="settings.opOffloadDesc"
              value={draft.opOffload}
              onChange={setTri('opOffload')}
            />
            <BoolTriStateField
              title="settings.noHost"
              description="settings.noHostDesc"
              value={draft.noHost}
              onChange={setTri('noHost')}
            />
            <BoolTriStateField
              title="settings.directIo"
              description="settings.directIoDesc"
              value={draft.directIo}
              onChange={setTri('directIo')}
            />
            <BoolTriStateField
              title="settings.mlock"
              description="settings.mlockDesc"
              value={draft.mlock}
              onChange={setTri('mlock')}
            />
            <BoolTriStateField
              title="settings.mmap"
              description="settings.mmapDesc"
              value={draft.mmap}
              onChange={setTri('mmap')}
            />
            <BoolTriStateField
              title="settings.checkTensors"
              description="settings.checkTensorsDesc"
              value={draft.checkTensors}
              onChange={setTri('checkTensors')}
            />
            <TextField
              title="settings.rpc"
              description="settings.rpcDesc"
              value={draft.rpc}
              onChange={set('rpc')}
              placeholder="settings.rpcHint"
            />
            
          </Section>
<Section title="settings.ctxBatch" description="settings.ctxBatchDesc">
            <NumberField
              title="settings.ctxLen"
              description="settings.ctxLenDesc"
              value={draft.ctxSize}
              onChange={setInt('ctxSize')}
              min={0}
              defaultValue="0"
            />
            <NumberField
              title="settings.logicalBatch"
              description="settings.logicalBatchDesc"
              value={draft.batchSize}
              onChange={setInt('batchSize')}
              min={1}
              defaultValue="2048"
            />
            <NumberField
              title="settings.physicalBatch"
              description="settings.physicalBatchDesc"
              value={draft.ubatchSize}
              onChange={setInt('ubatchSize')}
              min={1}
              defaultValue="512"
            />
            <NumberField
              title="settings.genThreads"
              description="settings.httpThreadsDesc"
              value={draft.threads}
              onChange={setInt('threads')}
              min={-1}
              defaultValue="-1"
            />
            <NumberField
              title="settings.batchThreads"
              description="settings.batchThreadsDesc"
              value={draft.threadsBatch}
              onChange={setInt('threadsBatch')}
              min={-1}
              defaultValue="-1"
            />
          
<TextField
              title="settings.cpuMask"
              description="settings.cpuMaskDesc"
              value={draft.cpuMask}
              onChange={set('cpuMask')}
            />
            <TextField
              title="settings.cpuRange"
              description="settings.cpuRangeDesc"
              value={draft.cpuRange}
              onChange={set('cpuRange')}
              placeholder="settings.cpuRangeHint"
            />
            <SelectField
              title="settings.cpuStrict"
              description="settings.cpuStrictDesc"
              value={draft.cpuStrict === null ? null : String(draft.cpuStrict)}
              onChange={(v) =>
                setDraft((prev) => ({
                  ...prev,
                  cpuStrict: v === null ? null : Number(v),
                }))
              }
              options={ON_OFF_01}
            />
            <SelectField
              title="settings.prio"
              description="settings.prioDesc"
              value={draft.prio === null ? null : String(draft.prio)}
              onChange={(v) =>
                setDraft((prev) => ({ ...prev, prio: v === null ? null : Number(v) }))
              }
              options={PRIO}
            />
            <NumberField
              title="settings.poll"
              description="settings.pollDesc"
              value={draft.poll}
              onChange={setInt('poll')}
              min={0}
              max={100}
              defaultValue="50"
            />
            <TextField
              title="settings.cpuMaskBatch"
              description="settings.cpuMaskBatchDesc"
              value={draft.cpuMaskBatch}
              onChange={set('cpuMaskBatch')}
            />
            <TextField
              title="settings.cpuRangeBatch"
              description="settings.cpuRangeBatchDesc"
              value={draft.cpuRangeBatch}
              onChange={set('cpuRangeBatch')}
            />
            <NumberField
              title="settings.cpuStrictBatch"
              description="settings.cpuStrictBatchDesc"
              value={draft.cpuStrictBatch}
              onChange={setInt('cpuStrictBatch')}
              min={0}
              max={1}
              defaultValue="0"
            />
            <NumberField
              title="settings.prioBatch"
              description="settings.prioBatchDesc"
              value={draft.prioBatch}
              onChange={setInt('prioBatch')}
              min={0}
              max={3}
              defaultValue="0"
            />
            <NumberField
              title="settings.pollBatch"
              description="settings.pollBatchDesc"
              value={draft.pollBatch}
              onChange={setInt('pollBatch')}
              min={0}
              max={1}
              defaultValue="0"
            />
            <SelectField
              title="settings.ropeScaleMode"
              description="settings.ropeAlgoDesc"
              value={draft.ropeScaling}
              onChange={(v) => set('ropeScaling')(v ?? '')}
              unsetValue=""
              options={ROPE_SCALING}
            />
            <NumberField
              title="settings.ropeScale"
              description="settings.ropeScaleOnly"
              value={draft.ropeScale}
              onChange={setNum('ropeScale')}
              min={1}
              step={0.25}
              defaultValue="1"
            />
            <NumberField
              title="settings.ropeFreqBase"
              description="settings.ropeFreqBaseDesc"
              value={draft.ropeFreqBase}
              onChange={setNum('ropeFreqBase')}
              step={0.01}
              defaultValue=""
            />
            <NumberField
              title="settings.ropeFreqScale"
              description="settings.ropeFreqScaleDesc"
              value={draft.ropeFreqScale}
              onChange={setNum('ropeFreqScale')}
              step={0.01}
              defaultValue=""
            />
            <NumberField
              title="opt.rope.yarn"
              description="settings.ctxLenDesc"
              value={draft.yarnOrigCtx}
              onChange={setInt('yarnOrigCtx')}
              min={0}
              defaultValue="0"
            />
            {draft.ropeScaling === 'yarn' && (
              <>
                <NumberField
                  title="settings.yarnExtFactor"
                  description="settings.yarnExtFactorDesc"
                  value={draft.yarnExtFactor}
                  onChange={setNum('yarnExtFactor')}
                  step={0.01}
                  defaultValue="-1"
                />
                <NumberField
                  title="settings.yarnAttnFactor"
                  description="settings.yarnAttnFactorDesc"
                  value={draft.yarnAttnFactor}
                  onChange={setNum('yarnAttnFactor')}
                  step={0.01}
                  defaultValue="-1"
                />
                <NumberField
                  title="settings.yarnBetaSlow"
                  description="settings.yarnBetaSlowDesc"
                  value={draft.yarnBetaSlow}
                  onChange={setNum('yarnBetaSlow')}
                  step={0.01}
                  defaultValue="-1"
                />
                <NumberField
                  title="settings.yarnBetaFast"
                  description="settings.yarnBetaFastDesc"
                  value={draft.yarnBetaFast}
                  onChange={setNum('yarnBetaFast')}
                  step={0.01}
                  defaultValue="-1"
                />
              </>
            )}
          
          </Section>
<Section title="settings.capacity" description="settings.capacityDesc">
            <BoolTriStateField
              title="settings.fit"
              description="settings.fitDesc"
              value={draft.fit === null ? null : draft.fit === 'on'}
              onChange={(v) =>
                setDraft((prev) => ({ ...prev, fit: v === null ? null : v ? 'on' : 'off' }))
              }
            />
            <TextField
              title="settings.fitTarget"
              description="settings.fitTargetDesc"
              value={draft.fitTarget}
              onChange={set('fitTarget')}
              placeholder="1024"
            />
            <NumberField
              title="settings.fitCtx"
              description="settings.fitCtxDesc"
              value={draft.fitCtx}
              onChange={setInt('fitCtx')}
              min={0}
              defaultValue="4096"
            />
            <NumberField
              title="settings.cacheRam"
              description="settings.cacheRamDesc"
              value={draft.cacheRam}
              onChange={setInt('cacheRam')}
              defaultValue="8192"
            />
            <BoolTriStateField
              title="settings.kvUnified"
              description="settings.kvUnifiedDesc"
              value={draft.kvUnified}
              onChange={setTri('kvUnified')}
            />
            <NumberField
              title="settings.kvUnifiedPerSlot"
              description="settings.kvUnifiedPerSlotDesc"
              value={draft.kvUnifiedPerSlot}
              onChange={setInt('kvUnifiedPerSlot')}
              min={0}
            />
            <BoolTriStateField
              title="settings.cacheIdleSlots"
              description="settings.cacheIdleSlotsDesc"
              value={draft.cacheIdleSlots}
              onChange={setTri('cacheIdleSlots')}
            />
            <BoolTriStateField
              title="settings.swaFull"
              description="settings.swaFullDesc"
              value={draft.swaFull}
              onChange={setTri('swaFull')}
            />
            <NumberField
              title="settings.keep"
              description="settings.keepDesc"
              value={draft.keep}
              onChange={setInt('keep')}
              defaultValue="0"
            />
            <BoolTriStateField
              title="settings.contextShift"
              description="settings.contextShiftDesc"
              value={draft.contextShift}
              onChange={setTri('contextShift')}
            />
            <NumberField
              title="settings.ctxCheckpoints"
              description="settings.ctxCheckpointsDesc"
              value={draft.ctxCheckpoints}
              onChange={setInt('ctxCheckpoints')}
              min={0}
              defaultValue="32"
            />
            <NumberField
              title="settings.checkpointMinStep"
              description="settings.checkpointMinStepDesc"
              value={draft.checkpointMinStep}
              onChange={setInt('checkpointMinStep')}
              min={0}
              defaultValue="8192"
            />
          </Section>
<Section title="settings.samplingMain" description="settings.samplingMainDesc">
            <NumberField
              title="settings.temp"
              description="settings.tempDesc"
              value={draft.temp}
              onChange={setNum('temp')}
              min={0}
              step={0.05}
              defaultValue="0.8"
            />
            <NumberField
              title="settings.topK"
              description="settings.topKDesc"
              value={draft.topK}
              onChange={setInt('topK')}
              min={0}
              defaultValue="40"
            />
            <NumberField
              title="settings.topP"
              description="settings.topPDesc"
              value={draft.topP}
              onChange={setNum('topP')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0.95"
            />
            <NumberField
              title="settings.minP"
              description="settings.minPDesc"
              value={draft.minP}
              onChange={setNum('minP')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0.05"
            />
            <NumberField
              title="settings.typicalP"
              description="settings.typicalPDesc"
              value={draft.typicalP}
              onChange={setNum('typicalP')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="1"
            />
            <NumberField
              title="settings.topNsigma"
              description="settings.topNsigmaDesc"
              value={draft.topNsigma}
              onChange={setNum('topNsigma')}
              step={0.01}
              defaultValue="-1"
            />
            <NumberField
              title="settings.predict"
              description="settings.predictDesc"
              value={draft.predict}
              onChange={setInt('predict')}
              min={-1}
              defaultValue="-1"
            />
            <NumberField
              title="settings.seed"
              description="settings.seedDesc"
              value={draft.seed}
              onChange={setInt('seed')}
              defaultValue="-1"
            />
            <TextField
              title="settings.samplers"
              description="settings.samplersDesc"
              value={draft.samplers}
              onChange={set('samplers')}
              placeholder="settings.samplersHint"
            />
            <TextField
              title="settings.samplerSeq"
              description="settings.samplerSeqDesc"
              value={draft.samplerSeq}
              onChange={set('samplerSeq')}
              placeholder="settings.samplerSeqHint"
            />
            <BoolTriStateField
              title="settings.ignoreEos"
              description="settings.ignoreEosDesc"
              value={draft.ignoreEos}
              onChange={setTri('ignoreEos')}
            />
            <BoolTriStateField
              title="settings.backendSampling"
              description="settings.backendSamplingDesc"
              value={draft.backendSampling}
              onChange={setTri('backendSampling')}
            />
          
            <NumberField
              title="settings.repeatLastN"
              description="settings.repeatLastNDesc"
              value={draft.repeatLastN}
              onChange={setInt('repeatLastN')}
              min={-1}
              defaultValue="64"
            />
            <NumberField
              title="settings.repeatPenalty"
              description="settings.repeatPenaltyDesc"
              value={draft.repeatPenalty}
              onChange={setNum('repeatPenalty')}
              min={0}
              step={0.01}
              defaultValue="1"
            />
            <NumberField
              title="settings.presencePenalty"
              description="settings.presencePenaltyDesc"
              value={draft.presencePenalty}
              onChange={setNum('presencePenalty')}
              step={0.01}
              defaultValue="0"
            />
            <NumberField
              title="settings.frequencyPenalty"
              description="settings.freqPenaltyDesc"
              value={draft.frequencyPenalty}
              onChange={setNum('frequencyPenalty')}
              step={0.01}
              defaultValue="0"
            />
          
            <NumberField
              title="settings.dryMultiplier"
              description="settings.dryMultiplierDesc"
              value={draft.dryMultiplier}
              onChange={setNum('dryMultiplier')}
              min={0}
              step={0.01}
              defaultValue="0"
            />
            <NumberField
              title="settings.dryBase"
              description="settings.dryBaseDesc"
              value={draft.dryBase}
              onChange={setNum('dryBase')}
              min={0}
              step={0.05}
              defaultValue="1.75"
            />
            <NumberField
              title="settings.dryAllowedLength"
              description="settings.dryAllowedLengthDesc"
              value={draft.dryAllowedLength}
              onChange={setInt('dryAllowedLength')}
              min={0}
              defaultValue="2"
            />
            <NumberField
              title="settings.dryPenaltyLastN"
              description="settings.dryPenaltyLastNDesc"
              value={draft.dryPenaltyLastN}
              onChange={setInt('dryPenaltyLastN')}
              min={0}
              defaultValue="64"
            />
            <TextField
              title="settings.drySequenceBreaker"
              description="settings.drySequenceBreakerDesc"
              value={draft.drySequenceBreaker}
              onChange={set('drySequenceBreaker')}
              placeholder="settings.drySequenceBreakerHint"
            />
          
            <NumberField
              title="settings.xtcProbability"
              description="settings.xtcProbabilityDesc"
              value={draft.xtcProbability}
              onChange={setNum('xtcProbability')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0"
            />
            <NumberField
              title="settings.xtcThreshold"
              description="settings.xtcThresholdDesc"
              value={draft.xtcThreshold}
              onChange={setNum('xtcThreshold')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0.1"
            />
            <NumberField
              title="settings.adaptiveTarget"
              description="settings.adaptiveTargetDesc"
              value={draft.adaptiveTarget}
              onChange={setNum('adaptiveTarget')}
              step={0.01}
              defaultValue="-1"
            />
            <NumberField
              title="settings.adaptiveDecay"
              description="settings.adaptiveDecayDesc"
              value={draft.adaptiveDecay}
              onChange={setNum('adaptiveDecay')}
              step={0.01}
              defaultValue="0.9"
            />
            <NumberField
              title="settings.dynatempRange"
              description="settings.dynatempRangeDesc"
              value={draft.dynatempRange}
              onChange={setNum('dynatempRange')}
              min={0}
              step={0.01}
              defaultValue="0"
            />
            <NumberField
              title="settings.dynatempExp"
              description="settings.dynatempExpDesc"
              value={draft.dynatempExp}
              onChange={setNum('dynatempExp')}
              min={0}
              step={0.01}
              defaultValue="1"
            />
            <SelectField
              title="settings.mirostat"
              description="settings.mirostatDesc"
              value={draft.mirostat === null ? null : String(draft.mirostat)}
              onChange={(v) =>
                setDraft((prev) => ({
                  ...prev,
                  mirostat: v === null ? null : Number(v),
                }))
              }
              options={MIROSTAT}
            />
            <NumberField
              title="settings.mirostatLr"
              description="settings.mirostatLrDesc"
              value={draft.mirostatLr}
              onChange={setNum('mirostatLr')}
              step={0.01}
              defaultValue="0.1"
            />
            <NumberField
              title="settings.mirostatEnt"
              description="settings.mirostatEntDesc"
              value={draft.mirostatEnt}
              onChange={setNum('mirostatEnt')}
              step={0.1}
              defaultValue="5"
            />
          
            <TextField
              title="settings.grammar"
              description="settings.grammarDesc"
              value={draft.grammar}
              onChange={set('grammar')}
            />
            <TextField
              title="settings.grammarFile"
              description="settings.grammarFileDesc"
              value={draft.grammarFile}
              onChange={set('grammarFile')}
            />
            <TextField
              title="settings.jsonSchema"
              description="settings.jsonSchemaDesc"
              value={draft.jsonSchema}
              onChange={set('jsonSchema')}
              placeholder="settings.jsonSchemaHint"
            />
            <TextField
              title="settings.jsonSchemaFile"
              description="settings.jsonSchemaFileDesc"
              value={draft.jsonSchemaFile}
              onChange={set('jsonSchemaFile')}
            />
            <TextField
              title="settings.logitBias"
              description="settings.logitBiasDesc"
              value={draft.logitBias}
              onChange={set('logitBias')}
              placeholder="settings.logitBiasHint"
            />
          
          </Section>
<Section title="settings.specMain" description="settings.specMainDesc">
            <SelectField
              title="settings.specType"
              description="settings.specTypeDesc"
              value={draft.specType}
              onChange={(v) => set('specType')(v ?? '')}
              unsetValue=""
              options={SPEC_TYPE}
            />
            <NumberField
              title="settings.specDraftNMax"
              description="settings.specDraftNMaxDesc"
              value={draft.specDraftNMax}
              onChange={setInt('specDraftNMax')}
              min={0}
              defaultValue="3"
            />
            <NumberField
              title="settings.specDraftNMin"
              description="settings.specDraftNMinDesc"
              value={draft.specDraftNMin}
              onChange={setInt('specDraftNMin')}
              min={0}
              defaultValue="0"
            />
            <NumberField
              title="settings.specDraftPSplit"
              description="settings.specDraftPSplitDesc"
              value={draft.specDraftPSplit}
              onChange={setNum('specDraftPSplit')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0.1"
            />
            <NumberField
              title="settings.specDraftPMin"
              description="settings.specDraftPMinDesc"
              value={draft.specDraftPMin}
              onChange={setNum('specDraftPMin')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0"
            />
            <TextField
              title="settings.specDraftNgl"
              description="settings.specDraftNglDesc"
              value={draft.specDraftNgl}
              onChange={set('specDraftNgl')}
              placeholder="settings.specDraftNglHint"
            />
            <TextField
              title="settings.specDraftDevice"
              description="settings.specDraftDeviceDesc"
              value={draft.specDraftDevice}
              onChange={set('specDraftDevice')}
            />
            <NumberField
              title="settings.specDraftThreads"
              description="settings.specDraftThreadsDesc"
              value={draft.specDraftThreads}
              onChange={setInt('specDraftThreads')}
              min={-1}
              defaultValue="-1"
            />
            <SelectField
              title="settings.specDraftTypeK"
              description="settings.specDraftTypeKDesc"
              value={draft.specDraftTypeK}
              onChange={set('specDraftTypeK')}
              options={CACHE_TYPES}
            />
            <SelectField
              title="settings.specDraftTypeV"
              description="settings.specDraftTypeVDesc"
              value={draft.specDraftTypeV}
              onChange={set('specDraftTypeV')}
              options={CACHE_TYPES}
            />
            <NumberField
              title="settings.specDraftThreadsBatch"
              description="settings.specDraftThreadsBatchDesc"
              value={draft.specDraftThreadsBatch}
              onChange={setInt('specDraftThreadsBatch')}
              min={-1}
              defaultValue="-1"
            />
            <TextField
              title="settings.specDraftCpuMask"
              description="settings.specDraftCpuMaskDesc"
              value={draft.specDraftCpuMask}
              onChange={set('specDraftCpuMask')}
            />
            <TextField
              title="settings.specDraftCpuRange"
              description="settings.specDraftCpuRangeDesc"
              value={draft.specDraftCpuRange}
              onChange={set('specDraftCpuRange')}
            />
            <NumberField
              title="settings.specDraftCpuStrict"
              description="settings.specDraftCpuStrictDesc"
              value={draft.specDraftCpuStrict}
              onChange={setInt('specDraftCpuStrict')}
              min={0}
              max={1}
              defaultValue="0"
            />
            <NumberField
              title="settings.specDraftPrio"
              description="settings.specDraftPrioDesc"
              value={draft.specDraftPrio}
              onChange={setInt('specDraftPrio')}
              min={0}
              max={3}
              defaultValue="0"
            />
            <NumberField
              title="settings.specDraftPoll"
              description="settings.specDraftPollDesc"
              value={draft.specDraftPoll}
              onChange={setInt('specDraftPoll')}
              min={0}
              max={1}
              defaultValue="0"
            />
            <TextField
              title="settings.specDraftCpuMaskBatch"
              description="settings.specDraftCpuMaskBatchDesc"
              value={draft.specDraftCpuMaskBatch}
              onChange={set('specDraftCpuMaskBatch')}
            />
            <NumberField
              title="settings.specDraftCpuStrictBatch"
              description="settings.specDraftCpuStrictBatchDesc"
              value={draft.specDraftCpuStrictBatch}
              onChange={setInt('specDraftCpuStrictBatch')}
              min={0}
              max={1}
              defaultValue="0"
            />
            <NumberField
              title="settings.specDraftPrioBatch"
              description="settings.specDraftPrioBatchDesc"
              value={draft.specDraftPrioBatch}
              onChange={setInt('specDraftPrioBatch')}
              min={0}
              max={3}
              defaultValue="0"
            />
            <NumberField
              title="settings.specDraftPollBatch"
              description="settings.specDraftPollBatchDesc"
              value={draft.specDraftPollBatch}
              onChange={setInt('specDraftPollBatch')}
              min={0}
              max={1}
              defaultValue="0"
            />
            <TextField
              title="settings.specDraftOverrideTensor"
              description="settings.specDraftOverrideTensorDesc"
              value={draft.specDraftOverrideTensor}
              onChange={set('specDraftOverrideTensor')}
              placeholder="settings.specDraftOverrideTensorHint"
            />
            <BoolTriStateField
              title="settings.specDraftBackendSampling"
              description="settings.specDraftBackendSamplingDesc"
              value={draft.specDraftBackendSampling}
              onChange={setTri('specDraftBackendSampling')}
            />
            <BoolTriStateField
              title="settings.specDraftCpuMoe"
              description="settings.specDraftCpuMoeDesc"
              value={draft.specDraftCpuMoe}
              onChange={setTri('specDraftCpuMoe')}
            />
            <NumberField
              title="settings.specDraftNCpuMoe"
              description="settings.specDraftNCpuMoeDesc"
              value={draft.specDraftNCpuMoe}
              onChange={setInt('specDraftNCpuMoe')}
              min={0}
            />
          </Section>
<Section title="settings.ngram" description="settings.ngramDesc">
            <NumberField
              title="settings.specNgramModNMin"
              description="settings.specNgramModNMinDesc"
              value={draft.specNgramModNMin}
              onChange={setInt('specNgramModNMin')}
              min={0}
              defaultValue="48"
            />
            <NumberField
              title="settings.specNgramModNMax"
              description="settings.specNgramModNMaxDesc"
              value={draft.specNgramModNMax}
              onChange={setInt('specNgramModNMax')}
              min={0}
              defaultValue="64"
            />
            <NumberField
              title="settings.specNgramModNMatch"
              description="settings.specNgramModNMatchDesc"
              value={draft.specNgramModNMatch}
              onChange={setInt('specNgramModNMatch')}
              min={0}
              defaultValue="24"
            />
            <NumberField
              title="settings.specNgramSimpleSizeN"
              description="settings.specNgramSizeNDesc"
              value={draft.specNgramSimpleSizeN}
              onChange={setInt('specNgramSimpleSizeN')}
              min={0}
              defaultValue="12"
            />
            <NumberField
              title="settings.specNgramSimpleSizeM"
              description="settings.specNgramSizeMDesc"
              value={draft.specNgramSimpleSizeM}
              onChange={setInt('specNgramSimpleSizeM')}
              min={0}
              defaultValue="48"
            />
            <NumberField
              title="settings.specNgramSimpleMinHits"
              description="settings.specNgramMinHitsDesc"
              value={draft.specNgramSimpleMinHits}
              onChange={setInt('specNgramSimpleMinHits')}
              min={0}
              defaultValue="1"
            />
            <NumberField
              title="settings.specNgramMapKSizeN"
              description="settings.specNgramSizeNDesc"
              value={draft.specNgramMapKSizeN}
              onChange={setInt('specNgramMapKSizeN')}
              min={0}
              defaultValue="12"
            />
            <NumberField
              title="settings.specNgramMapKSizeM"
              description="settings.specNgramSizeMDesc"
              value={draft.specNgramMapKSizeM}
              onChange={setInt('specNgramMapKSizeM')}
              min={0}
              defaultValue="48"
            />
            <NumberField
              title="settings.specNgramMapKMinHits"
              description="settings.specNgramMinHitsDesc"
              value={draft.specNgramMapKMinHits}
              onChange={setInt('specNgramMapKMinHits')}
              min={0}
              defaultValue="1"
            />
            <NumberField
              title="settings.specNgramMapK4vSizeN"
              description="settings.specNgramSizeNDesc"
              value={draft.specNgramMapK4vSizeN}
              onChange={setInt('specNgramMapK4vSizeN')}
              min={0}
              defaultValue="12"
            />
            <NumberField
              title="settings.specNgramMapK4vSizeM"
              description="settings.specNgramSizeMDesc"
              value={draft.specNgramMapK4vSizeM}
              onChange={setInt('specNgramMapK4vSizeM')}
              min={0}
              defaultValue="48"
            />
            <NumberField
              title="settings.specNgramMapK4vMinHits"
              description="settings.specNgramMinHitsDesc"
              value={draft.specNgramMapK4vMinHits}
              onChange={setInt('specNgramMapK4vMinHits')}
              min={0}
              defaultValue="1"
            />
          </Section>
<Section title="settings.http" description="settings.httpDesc">
            <BoolTriStateField
              title="settings.reusePort"
              description="settings.reusePortDesc"
              value={draft.reusePort}
              onChange={setTri('reusePort')}
            />
            <TextField
              title="settings.apiPrefix"
              description="settings.apiPrefixDesc"
              value={draft.apiPrefix}
              onChange={set('apiPrefix')}
            />
            <PathField
              title="settings.staticPath"
              description="settings.staticPathDesc"
              value={draft.staticPath}
              onChange={set('staticPath')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, staticPath: p })))
              }
            />
            <NumberField
              title="settings.ssePingInterval"
              description="settings.ssePingIntervalDesc"
              value={draft.ssePingInterval}
              onChange={setInt('ssePingInterval')}
              min={-1}
              defaultValue="30"
            />
            <NumberField
              title="settings.sleepIdleSeconds"
              description="settings.sleepIdleSecondsDesc"
              value={draft.sleepIdleSeconds}
              onChange={setInt('sleepIdleSeconds')}
              defaultValue="-1"
            />
          </Section>
<Section title="settings.security" description="settings.securityDesc">
            <TextField
              title="settings.apiKey.label"
              description="settings.apiKey.help"
              value={draft.apiKey}
              onChange={set('apiKey')}
            />
            <PathField
              title="settings.apiKeyFile"
              description="settings.apiKeyFileDesc"
              value={draft.apiKeyFile}
              onChange={set('apiKeyFile')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, apiKeyFile: p })))
              }
            />
            <PathField
              title="settings.sslKeyFile"
              description="settings.sslKeyFileDesc"
              value={draft.sslKeyFile}
              onChange={set('sslKeyFile')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, sslKeyFile: p })))
              }
            />
            <PathField
              title="settings.sslCertFile"
              description="settings.sslCertFileDesc"
              value={draft.sslCertFile}
              onChange={set('sslCertFile')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, sslCertFile: p })))
              }
            />
            <TextField
              title="settings.corsOrigins"
              description="settings.corsOriginsDesc"
              value={draft.corsOrigins}
              onChange={set('corsOrigins')}
              placeholder="settings.corsOriginsHint"
            />
            <TextField
              title="settings.corsMethods"
              description="settings.corsMethodsDesc"
              value={draft.corsMethods}
              onChange={set('corsMethods')}
              placeholder="settings.corsMethodsHint"
            />
            <TextField
              title="settings.corsHeaders"
              description="settings.corsHeadersDesc"
              value={draft.corsHeaders}
              onChange={set('corsHeaders')}
              placeholder="settings.corsHeadersHint"
            />
            <BoolTriStateField
              title="settings.corsCredentials"
              description="settings.corsCredentialsDesc"
              value={draft.corsCredentials}
              onChange={setTri('corsCredentials')}
            />
          </Section>
<Section title="settings.endpoints" description="settings.endpointsDesc">
            <BoolTriStateField
              title="settings.rerank"
              description="settings.rerankDesc"
              value={draft.rerank}
              onChange={setTri('rerank')}
            />
            <PathField
              title="settings.mediaPath"
              description="settings.mediaPathDesc"
              value={draft.mediaPath}
              onChange={set('mediaPath')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, mediaPath: p })))
              }
            />
            <PathField
              title="settings.slotSavePath"
              description="settings.slotSavePathDesc"
              value={draft.slotSavePath}
              onChange={set('slotSavePath')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, slotSavePath: p })))
              }
            />
            <PathField
              title="settings.logPromptsDir"
              description="settings.logPromptsDirDesc"
              value={draft.logPromptsDir}
              onChange={set('logPromptsDir')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, logPromptsDir: p })))
              }
            />
            <PathField
              title="settings.modelsDir"
              description="settings.modelsDirDesc"
              value={draft.modelsDir}
              onChange={set('modelsDir')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.modelRoot)
                  .then((p) => p && setDraft((prev) => ({ ...prev, modelsDir: p })))
              }
            />
            <PathField
              title="settings.modelsPreset"
              description="settings.modelsPresetDesc"
              value={draft.modelsPreset}
              onChange={set('modelsPreset')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, modelsPreset: p })))
              }
            />
            <NumberField
              title="settings.modelsMax"
              description="settings.modelsMaxDesc"
              value={draft.modelsMax}
              onChange={setInt('modelsMax')}
              min={0}
              defaultValue="4"
            />
            <BoolTriStateField
              title="settings.modelsAutoload"
              description="settings.modelsAutoloadDesc"
              value={draft.modelsAutoload}
              onChange={setTri('modelsAutoload')}
            />
          </Section>
<Section title="settings.template" description="settings.templateDesc">
            <TextField
              title="settings.chatTemplate"
              description="settings.chatTemplateDesc"
              value={draft.chatTemplate}
              onChange={set('chatTemplate')}
            />
            <PathField
              title="settings.chatTemplateFile"
              description="settings.chatTemplateFileDesc"
              value={draft.chatTemplateFile}
              onChange={set('chatTemplateFile')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, chatTemplateFile: p })))
              }
            />
            <TextField
              title="settings.chatTemplateKwargs"
              description="settings.chatTemplateKwargsDesc"
              value={draft.chatTemplateKwargs}
              onChange={set('chatTemplateKwargs')}
              placeholder="settings.chatTemplateKwargsHint"
            />
          </Section>
<Section title="settings.reasoning" description="settings.reasoningDesc">
            <SelectField
              title="settings.reasoningFormat"
              description="settings.reasoningFormatDesc"
              value={draft.reasoningFormat}
              onChange={(v) => set('reasoningFormat')(v ?? '')}
              unsetValue=""
              options={REASONING_FORMAT}
            />
            <SelectField
              title="settings.reasoning"
              description="settings.reasoningHint"
              value={draft.reasoning}
              onChange={set('reasoning')}
              options={REASONING}
            />
            <SelectField
              title="settings.reasoningEffort"
              description="settings.reasoningEffortDesc"
              value={draft.reasoningEffort}
              onChange={(v) => set('reasoningEffort')(v ?? '')}
              unsetValue=""
              options={REASONING_EFFORT}
            />
            <NumberField
              title="settings.reasoningBudget"
              description="settings.reasoningBudgetDesc"
              value={draft.reasoningBudget}
              onChange={setInt('reasoningBudget')}
              defaultValue="-1"
            />
            <TextField
              title="settings.reasoningBudgetMessage"
              description="settings.reasoningBudgetMessageDesc"
              value={draft.reasoningBudgetMessage}
              onChange={set('reasoningBudgetMessage')}
            />
            <BoolTriStateField
              title="settings.reasoningPreserve"
              description="settings.reasoningPreserveDesc"
              value={draft.reasoningPreserve}
              onChange={setTri('reasoningPreserve')}
            />
            <BoolTriStateField
              title="settings.skipChatParsing"
              description="settings.skipChatParsingDesc"
              value={draft.skipChatParsing}
              onChange={setTri('skipChatParsing')}
            />
            <BoolTriStateField
              title="settings.prefillAssistant"
              description="settings.prefillAssistantDesc"
              value={draft.prefillAssistant}
              onChange={setTri('prefillAssistant')}
            />
            <BoolTriStateField
              title="settings.warmup"
              description="settings.warmupDesc"
              value={draft.warmup}
              onChange={setTri('warmup')}
            />
          </Section>
<Section title="settings.behaviour" description="settings.behaviourDesc">
            <SelectField
              title="settings.pooling"
              description="settings.poolingDesc"
              value={draft.pooling}
              onChange={(v) => set('pooling')(v ?? '')}
              unsetValue=""
              options={POOLING}
            />
            <NumberField
              title="settings.embdNormalize"
              description="settings.embdNormalizeDesc"
              value={draft.embdNormalize}
              onChange={setInt('embdNormalize')}
              defaultValue="2"
            />
            <NumberField
              title="settings.slotPromptSimilarity"
              description="settings.slotPromptSimilarityDesc"
              value={draft.slotPromptSimilarity}
              onChange={setNum('slotPromptSimilarity')}
              min={0}
              max={1}
              step={0.01}
              defaultValue="0.1"
            />
            <BoolTriStateField
              title="settings.spmInfill"
              description="settings.spmInfillDesc"
              value={draft.spmInfill}
              onChange={setTri('spmInfill')}
            />
            <BoolTriStateField
              title="settings.special"
              description="settings.specialDesc"
              value={draft.special}
              onChange={setTri('special')}
            />
            <BoolTriStateField
              title="settings.offline"
              description="settings.offlineDesc"
              value={draft.offline}
              onChange={setTri('offline')}
            />
            <TextField
              title="settings.reversePrompt"
              description="settings.reversePromptDesc"
              value={draft.reversePrompt}
              onChange={set('reversePrompt')}
            />
            <BoolTriStateField
              title="settings.escape"
              description="settings.escapeDesc"
              value={draft.escape}
              onChange={setTri('escape')}
            />
            <PathField
              title="settings.lookupCacheStatic"
              description="settings.lookupCacheStaticDesc"
              value={draft.lookupCacheStatic}
              onChange={set('lookupCacheStatic')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, lookupCacheStatic: p })))
              }
            />
            <PathField
              title="settings.lookupCacheDynamic"
              description="settings.lookupCacheDynamicDesc"
              value={draft.lookupCacheDynamic}
              onChange={set('lookupCacheDynamic')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, lookupCacheDynamic: p })))
              }
            />
          </Section>
<Section title="settings.webuiTools" description="settings.webuiToolsDesc">
            <TextField
              title="settings.uiConfig"
              description="settings.uiConfigDesc"
              value={draft.uiConfig}
              onChange={set('uiConfig')}
            />
            <PathField
              title="settings.uiConfigFile"
              description="settings.uiConfigFileDesc"
              value={draft.uiConfigFile}
              onChange={set('uiConfigFile')}
              onBrowse={() =>
                void api
                  .pickFile(draft.llamaDir)
                  .then((p) => p && setDraft((prev) => ({ ...prev, uiConfigFile: p })))
              }
            />
            <BoolTriStateField
              title="settings.uiMcpProxy"
              description="settings.uiMcpProxyDesc"
              value={draft.uiMcpProxy}
              onChange={setTri('uiMcpProxy')}
            />
            <TextField
              title="settings.tools"
              description="settings.toolsDesc"
              value={draft.tools}
              onChange={set('tools')}
            />
            <TextField
              title="settings.toolsRuntime"
              description="settings.toolsRuntimeDesc"
              value={draft.toolsRuntime}
              onChange={set('toolsRuntime')}
            />
            <TextField
              title="settings.mcpServersConfig"
              description="settings.mcpServersConfigDesc"
              value={draft.mcpServersConfig}
              onChange={set('mcpServersConfig')}
            />
            <TextField
              title="settings.mcpServersJson"
              description="settings.mcpServersJsonDesc"
              value={draft.mcpServersJson}
              onChange={set('mcpServersJson')}
            />
            <BoolTriStateField
              title="settings.agent"
              description="settings.agentDesc"
              value={draft.agent}
              onChange={setTri('agent')}
            />
          </Section>
<Section title="settings.meta" description="settings.metaDesc">
            <TextField
              title="settings.tags"
              description="settings.tagsDesc"
              value={draft.tags}
              onChange={set('tags')}
              placeholder="settings.tagsHint"
            />
          </Section>
<Section title="logs.title" description="settings.verbosity">
            <SelectField
              title="logs.level"
              description="settings.verbosityDesc"
              value={draft.verbosity === null ? null : String(draft.verbosity)}
              onChange={(v) =>
                setDraft((prev) => ({
                  ...prev,
                  verbosity: v === null ? null : Number(v),
                }))
              }
              options={VERBOSITY}
            />
            <BoolTriStateField
              title="logs.timestamps"
              description="logs.tsDesc"
              value={draft.logTimestamps}
              onChange={setTri('logTimestamps')}
            />
            <BoolTriStateField
              title="settings.logPrefix"
              description="settings.logPrefixDesc"
              value={draft.logPrefix}
              onChange={setTri('logPrefix')}
            />
            <PathField
              title="logs.file"
              description="logs.fileDesc"
              value={draft.logFile}
              onChange={set('logFile')}
              onBrowse={() =>
                void api
                  .pickDirectory(draft.llamaDir)
                  .then(
                    (p) =>
                      p && setDraft((prev) => ({ ...prev, logFile: `${p}\\llama-server.log` })),
                  )
              }
            />
            <SelectField
              title="opt.logColors"
              description="settings.logColorsDesc"
              value={draft.logColors}
              onChange={(v) => set('logColors')(v ?? '')}
              unsetValue=""
              options={LOG_COLORS}
            />
            <BoolTriStateField
              title="settings.logDisable"
              description="settings.logDisableDesc"
              value={draft.logDisable}
              onChange={setTri('logDisable')}
            />
            <BoolTriStateField
              title="settings.perf"
              description="settings.perfDesc"
              value={draft.perf}
              onChange={setTri('perf')}
            />
          </Section>
<Card>
            <CardHeader>
              <CardTitle>{t('settings.advanced')}</CardTitle>
              <CardDescription>{t('settings.advancedDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field>
                <FieldTitle>{t('settings.extraArgs')}</FieldTitle>
                <Textarea
                  value={draft.extraArgs}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, extraArgs: e.target.value }))
                  }
                  placeholder={translateEn('common.defaultHint', { v: translateEn('settings.exampleArgs') })}
                  className="min-h-20 font-mono"
                />
                <FieldDescription>{t('settings.extraArgsDesc')}</FieldDescription>
              </Field>

              <Separator />

              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 [&>*]:min-w-0">
                <ToggleField
                  title="settings.killOnExit"
                  description="settings.killOnExitDesc"
                  checked={draft.killOnExit}
                  onChange={(v) => setDraft((prev) => ({ ...prev, killOnExit: v }))}
                />
                <ToggleField
                  title="settings.autoOpenBrowser"
                  description="settings.autoOpenBrowserDesc"
                  checked={draft.autoOpenBrowser}
                  onChange={(v) => setDraft((prev) => ({ ...prev, autoOpenBrowser: v }))}
                />
                <ToggleField
                  title="settings.cleanVramOnStart"
                  description="settings.cleanVramOnStartDesc"
                  checked={draft.cleanVramOnStart}
                  onChange={(v) => setDraft((prev) => ({ ...prev, cleanVramOnStart: v }))}
                />
                <ToggleField
                  title="settings.autoGotoWebui"
                  description="settings.autoGotoWebuiDesc"
                  checked={draft.autoGotoWebui}
                  onChange={(v) => setDraft((prev) => ({ ...prev, autoGotoWebui: v }))}
                />
              </div>

              <Separator />

              <Collapsible onOpenChange={(open) => open && void showPreview()}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
                  <Terminal />
                  {t('settings.previewCmd')}
                  <ChevronDown className="data-[open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                    {preview.length > 0
                      ? preview.join(' ')
                      : t('settings.previewCmdDesc')}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
          </div>
        </div>
      </div>
      </div>
    </SearchContext.Provider>
  )
}
