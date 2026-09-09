import * as React from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { useI18n, translateEn } from '@/lib/i18n'
import { estimateVram, formatGB } from '@/lib/model-presets'
import type { LaunchConfig, ModelMeta } from '@/lib/tauri-api'

// --------------------------------------------------------------- option consts
// label 统一用 i18n key；渲染时经 translateEn 强制英文（与设置页下拉一致）。
export const GPU_LAYERS_MODE = [
  { value: 'auto', label: 'opt.gpuLayers.auto' },
  { value: 'all', label: 'opt.gpuLayers.all' },
  { value: 'custom', label: 'opt.gpuLayers.custom' },
]

// KV 缓存精度：仅暴露推荐引擎实际产出的三种实用精度（其余 f32/bf16/q4_1 等
// 属于极端/罕见场景，留给设置页完整列表）。
export const KV_CACHE_TYPES = [
  { value: 'f16', label: 'f16' },
  { value: 'q8_0', label: 'q8_0' },
  { value: 'q4_0', label: 'q4_0' },
]

export const FLASH_ATTN = [
  { value: 'auto', label: 'opt.auto' },
  { value: 'on', label: 'opt.flashAttn.on' },
  { value: 'off', label: 'opt.flashAttn.off' },
]

const UNSET = '__unset__'

export type BadgeState = 'recommended' | 'manual' | null

/** 标签旁的「推荐 / 手动」徽标。导出供组合控件（如 GPU 卸载）复用。 */
export function ParamBadge({ badge }: { badge: BadgeState }) {
  const { t } = useI18n()
  if (!badge) return null
  return (
    <Badge
      variant={badge === 'manual' ? 'outline' : 'secondary'}
      className="ml-1 px-1.5 py-0 text-[10px] font-normal leading-4"
    >
      {badge === 'manual' ? t('settings.badgeManual') : t('settings.badgeRecommended')}
    </Badge>
  )
}

/** 标签 + 控件行右侧（与控件同行）的一键重置按钮。导出供组合控件复用。 */
export function ResetButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 text-muted-foreground"
      title={t('settings.resetToRecommended')}
      aria-label={t('settings.resetToRecommended')}
      disabled={disabled}
      onClick={onClick}
    >
      <RotateCcw className="size-3.5" />
    </Button>
  )
}

// ------------------------------------------------------------- ManagedNumberField
/** 数值参数，支持「推荐/手动」徽标与一键重置。value === null 表示未设置。 */
export function ManagedNumberField({
  title,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  defaultValue,
  badge = null,
  onReset,
}: {
  title: string
  description?: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  defaultValue?: string
  badge?: BadgeState
  onReset?: () => void
}) {
  const { t } = useI18n()
  const id = React.useId()
  const showReset = badge != null && !!onReset
  // 本地文本态：允许自由编辑/删除（含浮点中间态如 "0."），编辑中不抢占显示，
  // 外部值变化（重置 / 应用推荐 / 切模型）时再同步。避免受控 number 输入「删不掉」的问题。
  const [text, setText] = React.useState(value == null ? '' : String(value))
  const editingRef = React.useRef(false)
  React.useEffect(() => {
    if (!editingRef.current) setText(value == null ? '' : String(value))
  }, [value])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      onChange(null)
      return
    }
    const next = Number(trimmed)
    onChange(Number.isFinite(next) ? next : null)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {t(title)}
        <ParamBadge badge={badge} />
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          placeholder={defaultValue ? translateEn('common.defaultHint', { v: defaultValue }) : undefined}
          onFocus={() => {
            editingRef.current = true
          }}
          onChange={(e) => {
            const raw = e.target.value
            setText(raw)
            commit(raw)
          }}
          onBlur={() => {
            editingRef.current = false
            const trimmed = text.trim()
            if (trimmed === '') {
              onChange(null)
              return
            }
            const next = Number(trimmed)
            if (Number.isFinite(next)) {
              onChange(next)
              setText(String(next))
            } else {
              onChange(null)
              setText('')
            }
          }}
        />
        {showReset && <ResetButton disabled={false} onClick={onReset!} />}
      </div>
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

// ------------------------------------------------------------- ManagedSelectField
/** 下拉参数，支持「推荐/手动」徽标与一键重置。 */
export function ManagedSelectField({
  title,
  description,
  value,
  onChange,
  options,
  unsetValue,
  badge = null,
  onReset,
}: {
  title: string
  description?: string
  value: string | null
  onChange: (value: string | null) => void
  options: Array<{ value: string; label: string }>
  unsetValue?: string
  badge?: BadgeState
  onReset?: () => void
}) {
  const { t } = useI18n()
  const id = React.useId()
  const isUnset = value === null || (unsetValue !== undefined && value === unsetValue)
  const showReset = badge != null && !!onReset
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {t(title)}
        <ParamBadge badge={badge} />
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Select
          value={isUnset ? UNSET : (value ?? UNSET)}
          onValueChange={(v) => onChange(v === UNSET ? null : String(v))}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {translateEn(o.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showReset && <ResetButton disabled={false} onClick={onReset!} />}
      </div>
      {description && <FieldDescription>{t(description)}</FieldDescription>}
    </Field>
  )
}

// ------------------------------------------------------------- ManagedSliderField
/** 把任意滑块值吸附到最近的刻度（阈值内），否则原样返回。阈值由调用方按 2% 计算。 */
export function snapTo(raw: number, snaps: number[], threshold: number): number {
  for (const s of snaps) {
    if (Math.abs(raw - s) <= threshold) return s
  }
  return raw
}

/** token 数缩写：4096→4K，131072→128K。 */
function formatK(v: number): string {
  if (v >= 1024 * 1024) return `${Math.round(v / (1024 * 1024))}M`
  if (v >= 1024) return `${Math.round(v / 1024)}K`
  return String(v)
}

/** 滑块参数（带刻度磁吸 + 推荐/手动徽标 + 重置）。value 为具体数值，不含 null。 */
export function ManagedSliderField({
  title,
  value,
  onChange,
  min,
  max,
  snaps,
  badge = null,
  onReset,
  hideLabel = false,
}: {
  title: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  snaps: number[]
  badge?: BadgeState
  onReset?: () => void
  hideLabel?: boolean
}) {
  const { t } = useI18n()
  const showReset = badge != null && !!onReset
  return (
    <Field>
      {!hideLabel && (
        <FieldLabel htmlFor="ctx-slider">
          {t(title)}
          <ParamBadge badge={badge} />
        </FieldLabel>
      )}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {/* 用外层容器覆盖官方 Slider 的轨道/填充色，让深浅主题下都可见 */}
          <div className="slider-rail-visible py-1.5">
            <Slider
              min={min}
              max={max}
              step={1}
              value={[value]}
              onValueChange={(v) => {
                const arr = Array.isArray(v) ? v : [v]
                onChange(arr[0])
              }}
            />
          </div>
          {/* 刻度标签按数值百分比绝对定位（非等距刻度不能用 justify-between），
              并补偿官方 Slider thumbAlignment="edge" 的 thumbSize/2 内缩，使标签对齐 thumb 中心 */}
          <div className="relative mt-1 h-3">
            {snaps.map((s) => {
              const pct = ((s - min) / (max - min)) * 100
              const offsetPx = 6 - (pct / 100) * 12
              return (
                <span
                  key={s}
                  className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] leading-none text-muted-foreground"
                  style={{ left: `calc(${pct}% + ${offsetPx}px)` }}
                >
                  {formatK(s)}
                </span>
              )
            })}
          </div>
        </div>
        {showReset && <ResetButton disabled={false} onClick={onReset!} />}
      </div>
    </Field>
  )
}

// ----------------------------------------------------------------- LiveVramPanel
/** 实时显存预估面板：随受管字段（上下文 / 卸载层数 / KV 精度）变化联动，
 * VRAM 不足时给出可执行的调优建议。仅在选中模型且解析到体积时渲染。 */
export function LiveVramPanel({
  meta,
  sizeBytes,
  draft,
  vramTotalBytes,
}: {
  meta: ModelMeta
  sizeBytes: number
  draft: LaunchConfig
  vramTotalBytes: number | null
}) {
  const { t } = useI18n()
  const ctxSize = (draft.ctxSize ?? 0) > 0 ? (draft.ctxSize as number) : (meta.contextLength ?? 0)
  const est = estimateVram({
    sizeBytes,
    blockCount: meta.blockCount,
    embeddingLength: meta.embeddingLength,
    headCountKv: meta.headCountKv,
    keyLength: meta.keyLength,
    ctxSize,
    gpuLayersMode: draft.gpuLayersMode,
    gpuLayersValue: draft.gpuLayersValue,
    tensorDataLayout: meta.tensorDataLayout,
    kvCacheType: draft.cacheTypeK,
    vramTotalBytes,
  })
  const suggestions = React.useMemo(() => {
    const set = new Set<string>()
    if (est.fits === false) {
      if ((draft.ctxSize ?? 0) > 8192) set.add(t('settings.vramSugCtx'))
      if (draft.cacheTypeK === 'f16' || draft.cacheTypeK == null) set.add(t('settings.vramSugKv'))
      if (draft.gpuLayersMode === 'all') set.add(t('settings.vramSugAuto'))
      else if (draft.gpuLayersMode === 'custom') set.add(t('settings.vramSugLayers'))
      set.add(t('settings.vramSugAuto'))
    }
    return [...set]
  }, [est.fits, draft.ctxSize, draft.cacheTypeK, draft.gpuLayersMode, t])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('settings.vramEst')}</span>
        <span className="text-sm font-medium">
          {formatGB(est.totalBytes)}
          {est.vramTotalBytes ? ` / ${formatGB(est.vramTotalBytes)}` : ''}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={
            est.fits === false
              ? 'h-full rounded-full bg-destructive'
              : 'h-full rounded-full bg-primary'
          }
          style={{ width: `${Math.min(100, (est.ratio ?? 0) * 100)}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">{t('models.vramWeights')}</p>
          <p className="font-medium">{formatGB(est.weightsBytes)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('models.vramKv')}</p>
          <p className="font-medium">{est.kvUnknown ? '—' : formatGB(est.kvBytes)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('models.vramOverhead')}</p>
          <p className="font-medium">{formatGB(est.overheadBytes)}</p>
        </div>
      </div>
      {est.fits === false ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t('settings.vramOverLimit')}</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : est.fits === true ? (
        <p className="text-sm text-muted-foreground">{t('models.vramFits')}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('models.vramUnknown')}</p>
      )}
    </div>
  )
}
