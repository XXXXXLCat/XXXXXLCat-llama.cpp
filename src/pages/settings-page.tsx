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
          {t('common.browse')}
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
  { value: 'auto', label: 'opt.gpuLayers.auto' },
  { value: 'all', label: 'opt.gpuLayers.all' },
  { value: 'custom', label: 'opt.gpuLayers.custom' },
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
  { value: '', label: 'opt.defaultDisabled' },
  { value: 'distribute', label: 'distribute' },
  { value: 'isolate', label: 'isolate' },
  { value: 'numactl', label: 'numactl' },
]

const ROPE_SCALING = [
  { value: 'none', label: 'opt.rope.none' },
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
              {t('common.unsaved')}
            </span>
          )}
          <Button variant="outline" onClick={() => void reloadConfig()} disabled={!dirty}>
            <RotateCcw />
            {t('common.revert')}
          </Button>
          <Button onClick={() => void saveConfig()} disabled={!dirty}>
            <Save />
            {t('common.save')}
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">

      <Section title="settings.paths" description="settings.llamaDirInfo">
        <PathField
          title="settings.llamaDir"
          description="settings.llamaDirDesc"
          value={config.llamaDir}
          onChange={set('llamaDir')}
          onBrowse={() => void api.pickDirectory(config.llamaDir).then((p) => p && updateConfig({ llamaDir: p }))}
        />
        <TextField
          title="settings.serverBin"
          description="settings.serverBinDesc"
          value={config.serverBin}
          onChange={set('serverBin')}
          placeholder="llama-server.exe"
        />
      </Section>

      <Section title="settings.serverNet" description="settings.serverNetDesc">
        <TextField
          title="settings.listenAddr"
          description="settings.listenAddrDesc"
          value={config.host}
          onChange={set('host')}
        />
        <NumberField
          title="settings.port"
          description="settings.portDesc"
          value={config.port}
          onChange={(v) => updateConfig({ port: Math.round(v) })}
          min={1}
          max={65535}
        />
        <NumberField
          title="settings.parallelSlots"
          description="settings.parallelSlotsDesc"
          value={config.parallel}
          onChange={(v) => updateConfig({ parallel: Math.round(v) })}
          min={-1}
        />
        <NumberField
          title="settings.readWriteTimeout"
          description="settings.readWriteTimeoutDesc"
          value={config.timeout}
          onChange={(v) => updateConfig({ timeout: Math.round(v) })}
          min={1}
        />
        <NumberField
          title="settings.httpThreads"
          description="settings.httpThreadsDesc"
          value={config.threadsHttp}
          onChange={(v) => updateConfig({ threadsHttp: Math.round(v) })}
          min={-1}
        />
        <TextField
          title="settings.modelAlias"
          description="settings.modelAliasDesc"
          value={config.alias}
          onChange={set('alias')}
        />
        <TextField
          title="API Key"
          description="settings.apiKeyDesc"
          value={config.apiKey}
          onChange={set('apiKey')}
        />
        <ToggleField
          title="console.continuousBatching"
          description="settings.enableParallel"
          checked={config.contBatching}
          onChange={(v) => updateConfig({ contBatching: v })}
        />
        <ToggleField
          title="settings.webui"
          description="settings.disableWebuiDesc"
          checked={config.webui}
          onChange={(v) => updateConfig({ webui: v })}
        />
        <ToggleField
          title="settings.slotsEndpoint"
          description="settings.slotsEndpointDesc"
          checked={config.slotsEndpoint}
          onChange={(v) => updateConfig({ slotsEndpoint: v })}
        />
        <ToggleField
          title="settings.prometheus"
          description="settings.prometheusDesc"
          checked={config.metrics}
          onChange={(v) => updateConfig({ metrics: v })}
        />
        <ToggleField
          title="settings.props"
          description="settings.propsDesc"
          checked={config.props}
          onChange={(v) => updateConfig({ props: v })}
        />
        <ToggleField
          title="settings.embedding"
          description="settings.embeddingDesc"
          checked={config.embedding}
          onChange={(v) => updateConfig({ embedding: v })}
        />
        <ToggleField
          title="settings.jinja"
          description="settings.jinjaDesc"
          checked={config.jinja}
          onChange={(v) => updateConfig({ jinja: v })}
        />
      </Section>

      <Section title="settings.modelVram" description="settings.modelVramDesc">
        <SelectField
          title="settings.gpuLayersMode"
          description="settings.gpuLayersModeDesc"
          value={config.gpuLayersMode}
          onChange={set('gpuLayersMode')}
          options={GPU_LAYERS_MODE}
        />
        <NumberField
          title="settings.customGpuLayers"
          description="settings.customGpuLayersDesc"
          value={config.gpuLayersValue}
          onChange={(v) => updateConfig({ gpuLayersValue: Math.round(v) })}
          min={0}
          disabled={config.gpuLayersMode !== 'custom'}
        />
        <SelectField
          title="Flash Attention"
          description="settings.fusedAttn"
          value={config.flashAttn}
          onChange={set('flashAttn')}
          options={FLASH_ATTN}
        />
        <SelectField
          title="settings.multiGpuSplit"
          description="settings.multiGpuSplitDesc"
          value={config.splitMode}
          onChange={set('splitMode')}
          options={SPLIT_MODE}
        />
        <NumberField
          title="settings.mainGpu"
          description="settings.mainGpuDesc"
          value={config.mainGpu}
          onChange={(v) => updateConfig({ mainGpu: Math.round(v) })}
          min={0}
        />
        <TextField
          title="settings.tensorSplit"
          description="opt.tensorSplit.example"
          value={config.tensorSplit}
          onChange={set('tensorSplit')}
          placeholder="settings.tensorSplitDesc"
        />
        <TextField
          title="settings.deviceList"
          description="settings.deviceListDesc"
          value={config.device}
          onChange={set('device')}
        />
        <SelectField
          title="settings.loadMode"
          description="settings.loadModeDesc"
          value={config.loadMode}
          onChange={set('loadMode')}
          options={LOAD_MODE}
        />
        <SelectField
          title="settings.numa"
          description="settings.numaDesc"
          value={config.numa}
          onChange={set('numa')}
          options={NUMA}
        />
        <SelectField
          title="settings.kCacheType"
          description="settings.kCacheTypeDesc"
          value={config.cacheTypeK}
          onChange={set('cacheTypeK')}
          options={CACHE_TYPES}
        />
        <SelectField
          title="settings.vCacheType"
          description="settings.vCacheTypeDesc"
          value={config.cacheTypeV}
          onChange={set('cacheTypeV')}
          options={CACHE_TYPES}
        />
        <ToggleField
          title="settings.offloadKvGpu"
          description="settings.offloadKvGpuDesc"
          checked={config.kvOffload}
          onChange={(v) => updateConfig({ kvOffload: v })}
        />
      </Section>

      <Section title="settings.ctxBatch" description="settings.ctxBatchDesc">
        <NumberField
          title="settings.ctxLen"
          description="settings.ctxLenDesc"
          value={config.ctxSize}
          onChange={(v) => updateConfig({ ctxSize: Math.round(v) })}
          min={0}
        />
        <NumberField
          title="settings.logicalBatch"
          description="settings.logicalBatchDesc"
          value={config.batchSize}
          onChange={(v) => updateConfig({ batchSize: Math.round(v) })}
          min={1}
        />
        <NumberField
          title="settings.physicalBatch"
          description="settings.physicalBatchDesc"
          value={config.ubatchSize}
          onChange={(v) => updateConfig({ ubatchSize: Math.round(v) })}
          min={1}
        />
        <NumberField
          title="settings.genThreads"
          description="settings.httpThreadsDesc"
          value={config.threads}
          onChange={(v) => updateConfig({ threads: Math.round(v) })}
          min={-1}
        />
        <NumberField
          title="settings.batchThreads"
          description="settings.batchThreadsDesc"
          value={config.threadsBatch}
          onChange={(v) => updateConfig({ threadsBatch: Math.round(v) })}
          min={-1}
        />
        <NumberField
          title="settings.maxTokens"
          description="settings.maxTokensDesc"
          value={config.nPredict}
          onChange={(v) => updateConfig({ nPredict: Math.round(v) })}
          min={-1}
        />
      </Section>

      <Section title="settings.sampling" description="settings.samplingDesc">
        <NumberField
          title="Temperature"
          description="settings.temp"
          value={config.temperature}
          onChange={(v) => updateConfig({ temperature: v })}
          min={0}
          max={2}
          step={0.01}
        />
        <NumberField
          title="Top-P"
          description="settings.topP"
          value={config.topP}
          onChange={(v) => updateConfig({ topP: v })}
          min={0}
          max={1}
          step={0.01}
        />
        <NumberField
          title="Top-K"
          description="settings.topK"
          value={config.topK}
          onChange={(v) => updateConfig({ topK: Math.round(v) })}
          min={0}
        />
        <NumberField
          title="Min-P"
          description="settings.topN"
          value={config.minP}
          onChange={(v) => updateConfig({ minP: v })}
          min={0}
          max={1}
          step={0.01}
        />
        <NumberField
          title="settings.repeatPenalty"
          description="settings.repeatPenaltyDesc"
          value={config.repeatPenalty}
          onChange={(v) => updateConfig({ repeatPenalty: v })}
          min={1}
          max={2}
          step={0.01}
        />
        <NumberField
          title="settings.repeatLastN"
          description="settings.repeatLastNDesc"
          value={config.repeatLastN}
          onChange={(v) => updateConfig({ repeatLastN: Math.round(v) })}
          min={0}
        />
        <NumberField
          title="settings.presencePenalty"
          description="settings.presencePenaltyDesc"
          value={config.presencePenalty}
          onChange={(v) => updateConfig({ presencePenalty: v })}
          min={-2}
          max={2}
          step={0.01}
        />
        <NumberField
          title="settings.freqPenalty"
          description="settings.freqPenaltyDesc"
          value={config.frequencyPenalty}
          onChange={(v) => updateConfig({ frequencyPenalty: v })}
          min={-2}
          max={2}
          step={0.01}
        />
        <NumberField
          title="settings.seed"
          description="settings.seedDesc"
          value={config.seed}
          onChange={(v) => updateConfig({ seed: Math.round(v) })}
          min={-1}
        />
      </Section>

      <Section title="settings.rope" description="settings.ropeDesc">
        <SelectField
          title="settings.ropeScaleMode"
          description="settings.ropeAlgoDesc"
          value={config.ropeScaling}
          onChange={set('ropeScaling')}
          options={ROPE_SCALING}
        />
        <NumberField
          title="settings.ropeScale"
          description="settings.ropeScaleOnly"
          value={config.ropeScale}
          onChange={(v) => updateConfig({ ropeScale: v })}
          min={1}
          step={0.25}
        />
        <NumberField
          title="opt.rope.yarn"
          description="settings.ctxLenDesc"
          value={config.yarnOrigCtx}
          onChange={(v) => updateConfig({ yarnOrigCtx: Math.round(v) })}
          min={0}
        />
        <ToggleField
          title="settings.visionOffloadGpu"
          description="settings.mmprojCpu"
          checked={config.mmprojOffload}
          onChange={(v) => updateConfig({ mmprojOffload: v })}
        />
        <TextField
          title="settings.visionDevice"
          description="settings.visionDeviceDesc"
          value={config.mmprojDevice}
          onChange={set('mmprojDevice')}
        />
      </Section>

      <Section title="logs.title" description="settings.verbosity">
        <SelectField
          title="logs.level"
          description="settings.verbosityDesc"
          value={String(config.verbosity)}
          onChange={(v) => updateConfig({ verbosity: Number(v) })}
          options={VERBOSITY}
        />
        <ToggleField
          title="logs.timestamps"
          description="logs.tsDesc"
          checked={config.logTimestamps}
          onChange={(v) => updateConfig({ logTimestamps: v })}
        />
        <PathField
          title="logs.file"
          description="logs.fileDesc"
          value={config.logFile}
          onChange={set('logFile')}
          onBrowse={() => void api.pickDirectory(config.llamaDir).then((p) => p && updateConfig({ logFile: `${p}\\llama-server.log` }))}
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
              value={config.extraArgs}
              onChange={(e) => updateConfig({ extraArgs: e.target.value })}
              placeholder={t('settings.exampleArgs')}
              className="min-h-20 font-mono"
            />
            <FieldDescription>
              {t('settings.extraArgsDesc')}
            </FieldDescription>
          </Field>

          <Separator />

          <div className="grid gap-5 sm:grid-cols-2">
            <ToggleField
              title="settings.killOnExit"
              description="settings.killOnExitDesc"
              checked={config.killOnExit}
              onChange={(v) => updateConfig({ killOnExit: v })}
            />
            <ToggleField
              title="settings.autoOpenBrowser"
              description="settings.autoOpenBrowserDesc"
              checked={config.autoOpenBrowser}
              onChange={(v) => updateConfig({ autoOpenBrowser: v })}
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
                {preview.length > 0 ? preview.join(' ') : t('settings.previewCmdDesc')}
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
