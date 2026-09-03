import * as React from 'react'
import {
  Check,
  FolderOpen,
  Image,
  LoaderCircle,
  RefreshCw,
  Search,
  TriangleAlert,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useLauncher } from '@/hooks/use-launcher'
import { useI18n } from '@/lib/i18n'
import { api, dirNameOf, fileNameOf, formatBytes } from '@/lib/tauri-api'
import type { MatchConfidence, ModelFile } from '@/lib/tauri-api'

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

export function ModelsPage() {
  const { t } = useI18n()
  const {
    config,
    models,
    scanning,
    scanError,
    mmprojMatch,
    updateConfig,
    selectModel,
    selectMmproj,
    refreshModels,
  } = useLauncher()

  const [keyword, setKeyword] = React.useState('')

  const textModels = React.useMemo(
    () => models.filter((m) => m.kind === 'text'),
    [models],
  )
  const visionModels = React.useMemo(
    () => models.filter((m) => m.kind === 'vision'),
    [models],
  )

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return textModels
    return textModels.filter(
      (m) => m.name.toLowerCase().includes(kw) || m.dir.toLowerCase().includes(kw),
    )
  }, [textModels, keyword])

  const grouped = React.useMemo(() => groupByDir(filtered), [filtered])

  const browseModelRoot = async () => {
    const picked = await api.pickDirectory(config.modelRoot)
    if (picked) updateConfig({ modelRoot: picked })
  }

  const confidence = mmprojMatch?.confidence ?? (config.mmprojPath ? 'none' : 'none')
  const meta = CONFIDENCE_META[confidence]

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-3">
      <Card>
        <CardHeader>
          <CardTitle>{t('models.modelDir')}</CardTitle>
          <CardDescription>{t('models.scanDirGguf')}</CardDescription>
          <CardAction>
            <Button variant="outline" onClick={() => void refreshModels()} disabled={scanning}>
              {scanning ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {t('common.rescan')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              value={config.modelRoot}
              onChange={(e) => updateConfig({ modelRoot: e.target.value })}
              placeholder={t('models.rootPlaceholder')}
            />
            <Button variant="outline" onClick={() => void browseModelRoot()}>
              <FolderOpen />
              {t('common.browse')}
            </Button>
          </div>
          {scanError && (
            <Alert variant="destructive" className="mt-3">
              <TriangleAlert />
              <AlertTitle>{t('common.scanFailed')}</AlertTitle>
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">
              {t('console.mainModel')} {textModels.length}
            </Badge>
            <Badge variant="outline">
              {t('models.vision')} {visionModels.length}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
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
                          variant={selected ? 'muted' : 'outline'}
                          render={
                            <button type="button" onClick={() => selectModel(m.path)} />
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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('models.visionMatch')}</CardTitle>
            <CardDescription>{t('models.multimodalProjector')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span>{t('models.autoMatchVision')}</span>
                <span className="text-muted-foreground">
                  {t('models.autoMatchDesc')}
                </span>
              </div>
              <Switch
                checked={config.autoMmproj}
                onCheckedChange={(checked) => updateConfig({ autoMmproj: checked })}
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
                    selectMmproj(value === '__none__' ? '' : String(value))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('models.noVision')}</SelectItem>
                    {visionModels.map((m) => (
                      <SelectItem key={m.path} value={m.path}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {visionModels.length === 0 && (
                  <p className="text-muted-foreground">
                    {t('models.noVisionInDir')}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
      </ScrollArea>
    </div>
  )
}
