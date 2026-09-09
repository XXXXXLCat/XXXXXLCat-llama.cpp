import * as React from 'react'
import {
  Check,
  ExternalLink,
  FolderOpen,
  Image,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import {
  ManagedNumberField,
  ManagedSliderField,
  ManagedSelectField,
  LiveVramPanel,
  ParamBadge,
  ResetButton,
  GPU_LAYERS_MODE,
  KV_CACHE_TYPES,
  FLASH_ATTN,
} from '@/components/launch-params'

import { useLauncher } from '@/hooks/use-launcher'
import { useI18n, translateEn } from '@/lib/i18n'
import { api, dirNameOf, fileNameOf, formatBytes } from '@/lib/tauri-api'
import type { MatchConfidence, ModelFile, ModelMeta, DraftMatch, ModelProfile } from '@/lib/tauri-api'
import { recommendConfig, type RecommendedConfig } from '@/lib/model-presets'

const CONFIDENCE_META: Record<
  MatchConfidence,
  { label: string; hint: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  exact: {
    label: 'models.matchExact',
    hint: 'models.hintExact',
    variant: 'default',
  },
  unique: {
    label: 'models.matchDirUnique',
    hint: 'models.hintUnique',
    variant: 'secondary',
  },
  weak: {
    label: 'models.matchWeak',
    hint: 'models.hintWeak',
    variant: 'outline',
  },
  none: {
    label: 'models.matchNotFound',
    hint: 'models.hintNotFound',
    variant: 'destructive',
  },
}

function groupByDir(models: ModelFile[]) {
  const map = new Map<string, ModelFile[]>()
  for (const m of models) {
    const list = map.get(m.dir)
    if (list) list.push(m)
    else map.set(m.dir, [m])
  }
  return [...map.entries()]
}

/** 上下文长度的数字输入框：滑块外的精确输入。本地持有文本态避免输入中间值被 clamp 跳变，
 * 失焦/回车时按 [min,max] 归一后提交；外部（滑块拖动、用训练上下文按钮）改变 value 时同步回显。 */
function CtxSizeInput({
  value,
  min,
  max,
  onCommit,
  className,
}: {
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
  className?: string
}) {
  const [text, setText] = React.useState(String(value))
  const [focused, setFocused] = React.useState(false)
  React.useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])
  return (
    <Input
      type="number"
      className={className ?? 'w-32'}
      min={min}
      max={max}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const raw = text.trim()
        if (raw === '' || !Number.isFinite(Number(raw))) {
          setText(String(value))
          return
        }
        const n = Number(raw)
        onCommit(Math.max(min, Math.min(n, max)))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function ModelsPage() {
  const { t } = useI18n()
  const {
    config,
    models,
    scanning,
    scanError,
    mmprojMatch,
    draftMatch,
    applyConfig,
    applyModel,
    applyMmproj,
    applyDraft,
    flushConfigSave,
    refreshModels,
    parseGguf,
    metrics,
    modelLibraries,
    setModelLibraries,
    profiles,
    saveProfile,
    deleteProfile,
    applyProfile,
  } = useLauncher()

  const [keyword, setKeyword] = React.useState('')
  // 选中主模型的真实 GGUF 元数据（按需解析，按路径缓存）。
  const [modelMeta, setModelMeta] = React.useState<ModelMeta | null>(null)
  const [metaLoading, setMetaLoading] = React.useState(false)
  const [metaError, setMetaError] = React.useState<string | null>(null)
  const metaPathRef = React.useRef<string | null>(null)
  const [profileName, setProfileName] = React.useState('')

  const textModels = React.useMemo(
    () => models.filter((m) => m.kind === 'text'),
    [models],
  )
  const visionModels = React.useMemo(
    () => models.filter((m) => m.kind === 'vision'),
    [models],
  )
  const draftModels = React.useMemo(
    () => models.filter((m) => m.kind === 'draft'),
    [models],
  )

  // 辅助模型（视觉 / 草稿）只认与主模型同文件夹的：跨文件夹的一律不计入候选。
  const modelDir = config?.modelPath ? dirNameOf(config.modelPath) : ''
  const sameFolderVision = React.useMemo(
    () => (modelDir ? visionModels.filter((m) => dirNameOf(m.path) === modelDir) : []),
    [visionModels, modelDir],
  )
  const sameFolderDraft = React.useMemo(
    () => (modelDir ? draftModels.filter((m) => dirNameOf(m.path) === modelDir) : []),
    [draftModels, modelDir],
  )

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return textModels
    return textModels.filter(
      (m) => m.name.toLowerCase().includes(kw) || m.dir.toLowerCase().includes(kw),
    )
  }, [textModels, keyword])

  const grouped = React.useMemo(() => groupByDir(filtered), [filtered])

  // 选中主模型后立即解析其真实元数据（架构 / 上下文长度 / 量化 / 参数量等）。
  // 按路径缓存：同一文件不重复读盘，切换模型才重新解析。
  React.useEffect(() => {
    const path = config.modelPath
    if (!path) {
      metaPathRef.current = null
      setModelMeta(null)
      setMetaError(null)
      setMetaLoading(false)
      return
    }
    // 注意：metaPathRef 只能在「解析成功」时写入，不能在 effect 开头就写。
    // 否则 React StrictMode 下 effect 双调用（mount→cleanup→mount）会让第一次的异步
    // 解析被 cancelled，第二次又因 metaPathRef 已等于 path 而跳过，导致 metaLoading
    // 永远停在 true（界面一直卡在「正在解析模型元数据」）。
    if (path === metaPathRef.current) return
    let cancelled = false
    setMetaLoading(true)
    setMetaError(null)
    void parseGguf(path)
      .then((meta) => {
        if (cancelled) return
        metaPathRef.current = path
        setModelMeta(meta)
      })
      .catch((e) => {
        if (cancelled) return
        setModelMeta(null)
        setMetaError(String(e))
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [config.modelPath, parseGguf])

  // 主模型真实体积（字节）：从扫描结果中按当前 modelPath 取。
  const selectedSizeBytes = React.useMemo(() => {
    const m = models.find((x) => x.path === config.modelPath)
    return m?.sizeBytes ?? 0
  }, [models, config.modelPath])

  const vramTotal = metrics?.gpus?.[0]?.memory_total ?? null

  // 硬件感知推荐（Auto Config）：按「模型体积 + 架构 + 显存 / 内存 / CPU」反解
  // 全套受管参数（卸载层数 / 上下文 / KV 精度 / batch / 线程 / 并行），共 8 项。
  const recommended = React.useMemo<RecommendedConfig | null>(() => {
    if (!modelMeta || selectedSizeBytes === 0) return null
    const gpu = metrics?.gpus?.[0] ?? null
    return recommendConfig(
      {
        sizeBytes: selectedSizeBytes,
        blockCount: modelMeta.blockCount,
        embeddingLength: modelMeta.embeddingLength,
        headCountKv: modelMeta.headCountKv,
        keyLength: modelMeta.keyLength,
        contextLength: modelMeta.contextLength,
        tensorDataLayout: modelMeta.tensorDataLayout,
        expertCount: modelMeta.expertCount,
        domain: modelMeta.domain,
        architecture: modelMeta.architecture,
      },
      {
        vramTotalBytes: vramTotal,
        ramTotalBytes: metrics?.memory_total ?? null,
        cpuPhysicalCount: metrics?.cpu_physical_count ?? null,
        cpuCount: metrics?.cpu_count ?? null,
      },
    )
  }, [modelMeta, selectedSizeBytes, metrics, vramTotal])

  // ----- 受管参数的「手动标记 / 重置」逻辑（模型页即调参主界面）-----
  const manual = config.manualParams ?? []
  const isManual = (...keys: string[]) => keys.some((k) => manual.includes(k))
  const badgeOf = (...keys: string[]): 'recommended' | 'manual' | null =>
    recommended ? (isManual(...keys) ? 'manual' : 'recommended') : null

  const setManaged = (key: keyof typeof config, value: unknown) => {
    // 改回推荐值 → 撤销「手动」标记（回到推荐/自动）；否则标为手动
    const isRecommended =
      recommended != null &&
      (recommended as unknown as Record<string, unknown>)[key as string] === value
    const manualParams = isRecommended
      ? manual.filter((k) => k !== key)
      : Array.from(new Set([...manual, key]))
    applyConfig({
      [key]: value,
      manualParams,
    } as unknown as typeof config)
  }
  const resetKey = (key: keyof typeof config, recValue: unknown) => {
    applyConfig({
      [key]: recValue,
      manualParams: manual.filter((k) => k !== key),
    } as unknown as typeof config)
  }
  // GPU 卸载（mode + value）视为一组：任一手动整组标「手动」，重置清两项。
  const resetGpu = () => {
    if (!recommended) return
    applyConfig({
      gpuLayersMode: recommended.gpuLayersMode,
      gpuLayersValue: recommended.gpuLayersValue,
      manualParams: manual.filter((k) => k !== 'gpuLayersMode' && k !== 'gpuLayersValue'),
    } as unknown as typeof config)
  }
  const applyRecommended = () => {
    if (!recommended) return
    applyConfig({
      gpuLayersMode: recommended.gpuLayersMode,
      gpuLayersValue: recommended.gpuLayersValue,
      ctxSize: recommended.ctxSize,
      cacheTypeK: recommended.cacheTypeK,
      cacheTypeV: recommended.cacheTypeV,
      batchSize: recommended.batchSize,
      ubatchSize: recommended.ubatchSize,
      threads: recommended.threads,
      flashAttn: recommended.flashAttn,
      temp: recommended.temp,
      topK: recommended.topK,
      topP: recommended.topP,
      minP: recommended.minP,
      repeatPenalty: recommended.repeatPenalty,
      presencePenalty: recommended.presencePenalty,
      // 显式套用推荐 = 撤销全部手动标记，使这些键回到「自动推荐」状态
      manualParams: [],
    })
  }

  // 主目录（modelLibraries[0]）同时写入 config.modelRoot 与模型库列表。
  const setPrimaryRoot = (path: string) => {
    applyConfig({ modelRoot: path })
    setModelLibraries([path, ...modelLibraries.slice(1)])
  }

  const browseLibrary = async (index: number) => {
    const picked = await api.pickDirectory(modelLibraries[index] ?? config.modelRoot)
    if (!picked) return
    if (index === 0) {
      setPrimaryRoot(picked)
      return
    }
    const next = modelLibraries.slice()
    next[index] = picked
    setModelLibraries(next)
  }

  const addLibrary = () => {
    setModelLibraries([...modelLibraries, ''])
  }

  const removeLibrary = (index: number) => {
    if (index === 0) return
    setModelLibraries(modelLibraries.filter((_, i) => i !== index))
  }

  const confidence = mmprojMatch?.confidence ?? (config.mmprojPath ? 'none' : 'none')
  const meta = CONFIDENCE_META[confidence]

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3">
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => void api.openInShell('https://github.com/ggml-org/llama.cpp/releases')}
        >
          <ExternalLink />
          {t('models.openReleases')}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">

          <div className="grid gap-3 lg:grid-cols-5">
            {/* 左列：模型库 + 模型列表 */}
            <div className="flex flex-col gap-3 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.paths')}</CardTitle>
              <CardDescription>{t('settings.llamaDirInfo')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <div className="flex gap-2">
                  <Input
                    id="llama-dir"
                    value={config.llamaDir}
                    onChange={(e) => applyConfig({ llamaDir: e.target.value })}
                    onBlur={flushConfigSave}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void api.pickDirectory(config.llamaDir).then((p) => p && applyConfig({ llamaDir: p }))}
                  >
                    <FolderOpen />
                    {t('common.browse')}
                  </Button>
                </div>
              </Field>
            </CardContent>
          </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('models.libraries')}</CardTitle>
                  <CardDescription>{t('models.librariesDesc')}</CardDescription>
                  <CardAction>
                    <Button variant="outline" onClick={() => void refreshModels()} disabled={scanning}>
                      {scanning ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                      {t('common.rescan')}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {modelLibraries.map((lib, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={lib}
                        onChange={(e) => {
                          const next = modelLibraries.slice()
                          next[idx] = e.target.value
                          if (idx === 0) setPrimaryRoot(next[0])
                          else setModelLibraries(next)
                        }}
                        onBlur={flushConfigSave}
                        placeholder={t('models.rootPlaceholder')}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void browseLibrary(idx)}
                      >
                        <FolderOpen />
                        {t('common.browse')}
                      </Button>
                      {idx > 0 && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => removeLibrary(idx)}
                          aria-label={t('common.remove')}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" className="self-start" onClick={addLibrary}>
                    <Plus />
                    {t('models.addLibrary')}
                  </Button>
                  {scanError && (
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertTitle>{t('common.scanFailed')}</AlertTitle>
                      <AlertDescription>{scanError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {t('console.mainModel')} {textModels.length}
                    </Badge>
                    <Badge variant="outline">
                      {t('models.vision')} {visionModels.length}
                    </Badge>
                    <Badge variant="outline">
                      {t('models.draft')} {draftModels.length}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('console.mainModel')}</CardTitle>
                  <CardDescription>{t('models.totalTextModels', { n: textModels.length })}</CardDescription>
                  <CardAction>
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder={t('common.search')}
                        className="w-40 pl-7"
                      />
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {scanning && textModels.length === 0 ? (
                    <div className="flex items-center gap-2 py-8 text-muted-foreground">
                      <LoaderCircle className="animate-spin" />
                      {t('models.scanning')}
                    </div>
                  ) : grouped.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {t('models.noGgufMain')}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {grouped.map(([dir, items]) => (
                        <div key={dir} className="flex flex-col gap-1">
                          <p className="px-1 text-muted-foreground">{dir}</p>
                          {items.map((m) => {
                            const selected = config.modelPath === m.path
                            return (
                              <Item
                                key={m.path}
                                variant={selected ? 'outline' : 'default'}
                                render={
                                  <button type="button" onClick={() => applyModel(m.path)} />
                                }
                              >
                                <ItemMedia variant="icon">
                                  <Image />
                                </ItemMedia>
                                <ItemContent>
                                  <ItemTitle>{m.name}</ItemTitle>
                                  <ItemDescription>
                                    {formatBytes(m.sizeBytes)}
                                    {m.quant ? ` · ${m.quant.toUpperCase()}` : ''}
                                    {m.params ? ` · ${m.params}` : ''}
                                    {m.family ? ` · ${m.family}` : ''}
                                  </ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                  {selected ? (
                                    <Badge>
                                      <Check />
                                      {t('common.selected')}
                                    </Badge>
                                  ) : null}
                                </ItemActions>
                              </Item>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              {/* 多模态：视觉 / 草稿匹配 */}
              <div className="flex flex-col gap-3">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('models.visionMatch')}</CardTitle>
                    <CardDescription>{t('models.multimodalProjector')}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <span>{t('models.autoMatchVision')}</span>
                        <span className="text-muted-foreground">{t('models.autoMatchDesc')}</span>
                      </div>
                      <Switch
                        checked={config.autoMmproj}
                        onCheckedChange={(checked) => applyConfig({ autoMmproj: checked })}
                      />
                    </div>
                    <Separator />
                    {config.autoMmproj ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={meta.variant}>{t(meta.label)}</Badge>
                          {mmprojMatch && (
                            <span className="text-muted-foreground">
                              {t('models.relevancePct', { p: Math.round(mmprojMatch.score * 100) })}
                            </span>
                          )}
                        </div>
                        {config.mmprojPath ? (
                          <>
                            <p className="break-all" title={config.mmprojPath}>
                              {fileNameOf(config.mmprojPath)}
                            </p>
                            <p className="text-muted-foreground">{dirNameOf(config.mmprojPath)}</p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void api.revealInExplorer(config.mmprojPath)}
                              >
                                {t('models.openFileLocation')}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Alert>
                            <TriangleAlert />
                            <AlertTitle>{t('models.noVisionFound')}</AlertTitle>
                            <AlertDescription>{t(meta.hint)}</AlertDescription>
                          </Alert>
                        )}
                        {confidence !== 'exact' && config.mmprojPath && (
                          <p className="text-muted-foreground">{t(meta.hint)}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="text-muted-foreground">{t('models.manualVision')}</span>
                        <Select
                          value={config.mmprojPath || '__none__'}
                          onValueChange={(value) =>
                            applyMmproj(value === '__none__' ? '' : String(value))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t('models.noVision')}</SelectItem>
                            {sameFolderVision.map((m) => (
                              <SelectItem key={m.path} value={m.path}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {sameFolderVision.length === 0 && (
                          <p className="text-muted-foreground">{t('models.noVisionInDir')}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('models.draftMatch')}</CardTitle>
                    <CardDescription>{t('models.speculativeDecoding')}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <span>{t('models.autoMatchDraft')}</span>
                        <span className="text-muted-foreground">{t('models.autoMatchDraftDesc')}</span>
                      </div>
                      <Switch
                        checked={config.autoDraft}
                        onCheckedChange={(checked) => applyConfig({ autoDraft: checked })}
                      />
                    </div>
                    <Separator />
                    {config.autoDraft ? (
                      <DraftMatchPanel match={draftMatch} path={config.draftModelPath} />
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="text-muted-foreground">{t('models.manualDraft')}</span>
                        <Select
                          value={config.draftModelPath || '__none__'}
                          onValueChange={(value) =>
                            applyDraft(value === '__none__' ? '' : String(value))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t('models.noDraft')}</SelectItem>
                            {sameFolderDraft.map((m) => (
                              <SelectItem key={m.path} value={m.path}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {sameFolderDraft.length === 0 && (
                          <p className="text-muted-foreground">{t('models.noDraftInDir')}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

            </div>

            {/* 右列：启动参数（调参主界面）+ 实时显存 */}
            <div className="flex flex-col gap-3 lg:col-span-2">
              {/* 预设 */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('models.profiles')}</CardTitle>
                  <CardDescription>{t('models.profilesDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder={t('models.profileNamePlaceholder')}
                      className="min-w-48 flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        const name = profileName.trim()
                        if (!name || !config.modelPath) return
                        saveProfile({
                          name,
                          modelPath: config.modelPath,
                          mmprojPath: config.mmprojPath,
                          draftModelPath: config.draftModelPath,
                          ctxSize: config.ctxSize,
                          gpuLayersMode: config.gpuLayersMode,
                          gpuLayersValue: config.gpuLayersValue,
                          flashAttn: config.flashAttn,
                        })
                        setProfileName('')
                      }}
                      disabled={!profileName.trim() || !config.modelPath}
                    >
                      {t('models.saveProfile')}
                    </Button>
                  </div>
                  {profiles.length === 0 ? (
                    <p className="py-2 text-center text-muted-foreground">{t('models.noProfiles')}</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {profiles.map((p: ModelProfile) => (
                        <div
                          key={p.name}
                          className="flex items-center justify-between gap-3 rounded-md border p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{p.name}</p>
                            <p className="truncate text-muted-foreground">{fileNameOf(p.modelPath)}</p>
                            <p className="text-muted-foreground">
                              {t('models.profileSummary', {
                                ctx: p.ctxSize === null ? '—' : p.ctxSize.toLocaleString(),
                                gpu: p.gpuLayersMode,
                                mmproj: p.mmprojPath ? fileNameOf(p.mmprojPath) : '—',
                                draft: p.draftModelPath ? fileNameOf(p.draftModelPath) : '—',
                              })}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button variant="outline" size="sm" onClick={() => applyProfile(p)}>
                              {t('models.applyProfile')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteProfile(p.name)}
                            >
                              {t('models.deleteProfile')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('models.launchParams')}</CardTitle>
                  <CardDescription>
                    {config.modelPath ? t('models.launchParamsDesc') : t('models.noModelSelected')}
                  </CardDescription>
                  <CardAction>
                    <Button
                      variant="default"
                      disabled={!recommended}
                      onClick={applyRecommended}
                    >
                      {t('models.applyRecommended')}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
              {/* 实时显存预估（随上下文 / 卸载层数 / KV 精度实时联动） */}
              {metaLoading ? (
                <div className="flex items-center gap-2 py-2 text-muted-foreground">
                  <LoaderCircle className="animate-spin" />
                  {t('models.parsingMeta')}
                </div>
              ) : metaError ? (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>{t('models.metaParseFailed')}</AlertTitle>
                  <AlertDescription>{metaError}</AlertDescription>
                </Alert>
              ) : !modelMeta || selectedSizeBytes === 0 ? (
                <p className="py-2 text-muted-foreground">{t('models.metaNeededForVram')}</p>
              ) : (
                <>
                  <LiveVramPanel
                    meta={modelMeta}
                    sizeBytes={selectedSizeBytes}
                    draft={config}
                    vramTotalBytes={vramTotal}
                  />
                </>
              )}

                  {!config.modelPath ? (
                    <p className="py-4 text-center text-muted-foreground">
                      {t('models.noModelSelected')}
                    </p>
                  ) : (
                    <>
                      {/* GPU 卸载（mode + 自定义层数 组合控件） */}
                      <Field>
                        <FieldLabel htmlFor="gpu-mode">
                          {t('settings.gpuLayersMode')}
                          <ParamBadge badge={badgeOf('gpuLayersMode', 'gpuLayersValue')} />
                        </FieldLabel>
                        <div className="flex items-center gap-2">
                          <Select
                            value={config.gpuLayersMode || 'auto'}
                            onValueChange={(v) => setManaged('gpuLayersMode', v)}
                          >
                            <SelectTrigger id="gpu-mode" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {GPU_LAYERS_MODE.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {translateEn(o.label)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {config.gpuLayersMode === 'custom' && (
                            <Input
                              id="gpu-custom"
                              type="number"
                              min={0}
                              value={config.gpuLayersValue === 999 ? '' : config.gpuLayersValue}
                              placeholder={translateEn('common.defaultHint', { v: '999' })}
                              onChange={(e) => {
                                const raw = e.target.value.trim()
                                if (raw === '') {
                                  setManaged('gpuLayersValue', 999)
                                  return
                                }
                                const v = Math.round(Number(raw))
                                setManaged('gpuLayersValue', Number.isFinite(v) && v >= 0 ? v : 999)
                              }}
                              className="w-28"
                            />
                          )}
                          {badgeOf('gpuLayersMode', 'gpuLayersValue') && (
                            <ResetButton disabled={false} onClick={resetGpu} />
                          )}
                        </div>
                        <FieldDescription>{t('settings.gpuLayersModeDesc')}</FieldDescription>
                      </Field>

                      {/* 上下文长度（滑块：左端 0=训练上下文 · 右端训练上下文 · 刻度 8K/16K/32K/64K/128K） */}
                      {(() => {
                        const trainCtx = modelMeta?.contextLength ?? 0
                        const minCtx = 0
                        // 轨道刻度：0 端由滑块起点表达「训练上下文」，不单列标签
                        const ctxSnaps = [4096, 16384, 32768, 65536, 131072].filter(
                          (x) => x <= trainCtx,
                        )
                        if (trainCtx > 0 && !ctxSnaps.includes(trainCtx)) ctxSnaps.push(trainCtx)
                        const raw =
                          config.ctxSize ?? recommended?.ctxSize ?? (trainCtx || minCtx)
                        const current = Math.max(minCtx, Math.min(raw, trainCtx || raw))
                        return (
                          <Field>
                            <FieldLabel htmlFor="ctx-slider">
                              {t('settings.ctxLen')}
                              <ParamBadge badge={badgeOf('ctxSize')} />
                            </FieldLabel>
                            {trainCtx > 0 && (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setManaged('ctxSize', trainCtx)}
                                >
                                  {t('models.useTrainedCtx', { n: trainCtx.toLocaleString() })}
                                </Button>
                                <CtxSizeInput
                                  value={current}
                                  min={minCtx}
                                  max={trainCtx}
                                  onCommit={(v) => setManaged('ctxSize', v)}
                                  className="flex-1"
                                />
                                <ResetButton
                                  disabled={false}
                                  onClick={() => resetKey('ctxSize', recommended?.ctxSize ?? null)}
                                />
                              </div>
                            )}
                            <ManagedSliderField
                              title="settings.ctxLen"
                              value={current}
                              onChange={(v) => setManaged('ctxSize', v)}
                              min={minCtx}
                              max={trainCtx || minCtx}
                              snaps={ctxSnaps}
                              badge={null}
                              hideLabel
                            />
                            <FieldDescription>{t('settings.ctxLenDesc')}</FieldDescription>
                          </Field>
                        )
                      })()}

                      {/* KV 缓存精度 K / V */}
                      <ManagedSelectField
                        title="settings.kCacheType"
                        description="settings.kCacheTypeDesc"
                        value={config.cacheTypeK}
                        onChange={(v) => setManaged('cacheTypeK', v ?? 'q8_0')}
                        options={KV_CACHE_TYPES}
                        badge={badgeOf('cacheTypeK')}
                        onReset={() => resetKey('cacheTypeK', recommended?.cacheTypeK ?? 'q8_0')}
                      />
                      <ManagedSelectField
                        title="settings.vCacheType"
                        description="settings.vCacheTypeDesc"
                        value={config.cacheTypeV}
                        onChange={(v) => setManaged('cacheTypeV', v ?? 'q8_0')}
                        options={KV_CACHE_TYPES}
                        badge={badgeOf('cacheTypeV')}
                        onReset={() => resetKey('cacheTypeV', recommended?.cacheTypeV ?? 'q8_0')}
                      />

                      {/* Flash Attention */}
                      <ManagedSelectField
                        title="Flash Attention"
                        description="settings.fusedAttn"
                        value={config.flashAttn}
                        onChange={(v) => setManaged('flashAttn', v ?? 'auto')}
                        options={FLASH_ATTN}
                        badge={badgeOf('flashAttn')}
                        onReset={() => resetKey('flashAttn', recommended?.flashAttn ?? 'auto')}
                      />
                      <Separator className="my-1 h-px w-full bg-muted-foreground/40" />


                      {/* 批大小 */}
                      <ManagedNumberField
                        title="settings.logicalBatch"
                        description="settings.logicalBatchDesc"
                        value={config.batchSize}
                        onChange={(v) => setManaged('batchSize', v)}
                        min={1}
                        badge={badgeOf('batchSize')}
                        onReset={() => resetKey('batchSize', recommended?.batchSize ?? 2048)}
                      />
                      <ManagedNumberField
                        title="settings.physicalBatch"
                        description="settings.physicalBatchDesc"
                        value={config.ubatchSize}
                        onChange={(v) => setManaged('ubatchSize', v)}
                        min={1}
                        badge={badgeOf('ubatchSize')}
                        onReset={() => resetKey('ubatchSize', recommended?.ubatchSize ?? 512)}
                      />

                      {/* 线程 / 并行 */}
                      <ManagedNumberField
                        title="settings.genThreads"
                        description="settings.httpThreadsDesc"
                        value={config.threads}
                        onChange={(v) => setManaged('threads', v ?? -1)}
                        min={-1}
                        badge={badgeOf('threads')}
                        onReset={() => resetKey('threads', recommended?.threads ?? -1)}
                      />
                      <Separator className="my-1 h-px w-full bg-muted-foreground/40" />


                      {/* 采样参数（推荐）：server-side 默认采样值，按架构推荐 */}
                      <ManagedNumberField
                        title="settings.temp"
                        description="settings.tempDesc"
                        value={config.temp}
                        onChange={(v) => setManaged('temp', v ?? 0.8)}
                        min={0}
                        step={0.05}
                        badge={badgeOf('temp')}
                        onReset={() => resetKey('temp', recommended?.temp ?? 0.8)}
                      />
                      <ManagedNumberField
                        title="settings.topK"
                        description="settings.topKDesc"
                        value={config.topK}
                        onChange={(v) => setManaged('topK', v ?? 40)}
                        min={0}
                        step={1}
                        badge={badgeOf('topK')}
                        onReset={() => resetKey('topK', recommended?.topK ?? 40)}
                      />
                      <ManagedNumberField
                        title="settings.topP"
                        description="settings.topPDesc"
                        value={config.topP}
                        onChange={(v) => setManaged('topP', v ?? 0.9)}
                        min={0}
                        step={0.01}
                        badge={badgeOf('topP')}
                        onReset={() => resetKey('topP', recommended?.topP ?? 0.9)}
                      />
                      <ManagedNumberField
                        title="settings.minP"
                        description="settings.minPDesc"
                        value={config.minP}
                        onChange={(v) => setManaged('minP', v ?? 0.0)}
                        min={0}
                        step={0.01}
                        badge={badgeOf('minP')}
                        onReset={() => resetKey('minP', recommended?.minP ?? 0.0)}
                      />
                      <ManagedNumberField
                        title="settings.repeatPenalty"
                        description="settings.repeatPenaltyDesc"
                        value={config.repeatPenalty}
                        onChange={(v) => setManaged('repeatPenalty', v ?? 1.1)}
                        min={0}
                        step={0.01}
                        badge={badgeOf('repeatPenalty')}
                        onReset={() => resetKey('repeatPenalty', recommended?.repeatPenalty ?? 1.1)}
                      />
                      <ManagedNumberField
                        title="settings.presencePenalty"
                        description="settings.presencePenaltyDesc"
                        value={config.presencePenalty}
                        onChange={(v) => setManaged('presencePenalty', v ?? 0.0)}
                        min={0}
                        step={0.01}
                        badge={badgeOf('presencePenalty')}
                        onReset={() => resetKey('presencePenalty', recommended?.presencePenalty ?? 0.0)}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function DraftMatchPanel({
  match,
  path,
}: {
  match: DraftMatch | null
  path: string
}) {
  const { t } = useI18n()
  const confidence = match?.confidence ?? 'none'
  const meta = CONFIDENCE_META[confidence]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge variant={meta.variant}>{t(meta.label)}</Badge>
        {match && (
          <span className="text-muted-foreground">
            {t('models.relevancePct', { p: Math.round(match.score * 100) })}
          </span>
        )}
      </div>
      {path ? (
        <>
          <p className="break-all" title={path}>
            {fileNameOf(path)}
          </p>
          <p className="text-muted-foreground">{dirNameOf(path)}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void api.revealInExplorer(path)}
            >
              {t('models.openFileLocation')}
            </Button>
          </div>
        </>
      ) : (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{t('models.noDraftFound')}</AlertTitle>
          <AlertDescription>{t('models.noDraftInDir')}</AlertDescription>
        </Alert>
      )}
      {confidence !== 'exact' && path && (
        <p className="text-muted-foreground">{t(meta.hint)}</p>
      )}
    </div>
  )
}
