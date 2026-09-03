import * as React from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Play, Save, Square, TriangleAlert } from 'lucide-react'

import { LogView } from '@/components/log-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useLauncher } from '@/hooks/use-launcher'
import { useI18n } from '@/lib/i18n'
import { api, endpointUrl, fileNameOf, formatBytes, formatDuration } from '@/lib/tauri-api'

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right">{children}</span>
    </div>
  )
}

/** 带数值的进度条（CPU / console.memory / console.gpuUtil / console.vram / settings.tempLabel 通用磁贴） */
function MetricBar({
  value,
  label,
  detail,
}: {
  value: number
  label: string
  detail?: string
}) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-sm">{detail ?? `${clamped.toFixed(0)}%`}</span>
      </div>
      <Progress value={clamped} />
    </div>
  )
}

export function ConsolePage() {
  const { t } = useI18n()
  const {
    config,
    status,
    logs,
    endpointUp,
    metrics,
    busy,
    dirty,
    actionError,
    models,
    startServer,
    stopServer,
    saveConfig,
    dismissError,
  } = useLauncher()

  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!status.running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status.running])

  const uptime = status.startedAt ? formatDuration(now - status.startedAt) : '—'
  const modelName = config.modelPath ? fileNameOf(config.modelPath) : t('common.notSelected')
  const modelSize = models.find((m) => m.path === config.modelPath)?.sizeBytes
  const mmprojName = config.mmprojPath ? fileNameOf(config.mmprojPath) : t('common.notEnabled')
  const mmprojSize = config.mmprojPath
    ? models.find((m) => m.path === config.mmprojPath)?.sizeBytes
    : undefined
  const modelSizeText = modelSize != null ? formatBytes(modelSize) : '—'
  const visionSizeText = mmprojSize != null ? formatBytes(mmprojSize) : null
  const fileVolume = visionSizeText ? `${modelSizeText} + ${visionSizeText}` : modelSizeText
  const endpoint = endpointUrl(config.host, config.port)
  const tail = React.useMemo(() => logs.slice(-80), [logs])

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-end gap-3 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant={status.running ? 'destructive' : 'default'}
            onClick={() => void (status.running ? stopServer() : startServer())}
            disabled={busy || (!status.running && !config.modelPath)}
          >
            {status.running ? <Square /> : <Play />}
            {status.running ? t('console.stopServer') : t('console.startServer')}
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">

      {actionError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t('common.failed')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span className="whitespace-pre-wrap">{actionError}</span>
            <div>
              <Button variant="outline" size="sm" onClick={dismissError}>
                {t('common.gotIt')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!config.modelPath && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{t('console.noModelSelected')}</AlertTitle>
          <AlertDescription>
            {t('console.goTo')}
            <Button variant="link" size="sm" render={<Link to="/models" />}>
              {t('nav.models')}
            </Button>
            {t('console.pickModel')}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('console.runtimeStatus')}</CardTitle>
            <CardDescription>{t('console.processInfo')}</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                disabled={!endpointUp || !config.webui}
                title={config.webui ? undefined : t('settings.webuiDisabledHint')}
                onClick={() => void api.openInShell(status.endpoint ?? endpoint)}
              >
                <ExternalLink />
                {t('console.openWebUI')}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <InfoRow label={t('console.endpoint')}>{endpoint}</InfoRow>
              <InfoRow label={t('console.pid')}>{status.pid ?? '—'}</InfoRow>
              <InfoRow label={t('console.uptime')}>{uptime}</InfoRow>
              <InfoRow label={t('console.exitCode')}>
                {status.exitCode === null
                  ? '—'
                  : status.exitCode === 0
                    ? t('console.exitNormal')
                    : t('console.exitError', { code: status.exitCode })}
              </InfoRow>
              <InfoRow label={t('console.continuousBatching')}>
                {config.contBatching ? t('common.enabled') : t('common.disabled')}
              </InfoRow>
              <InfoRow label={t('console.contextLength')}>
                {config.ctxSize.toLocaleString()} tokens
              </InfoRow>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('console.currentModel')}</CardTitle>
            <CardDescription>{t('console.mainAndVision')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col">
              <InfoRow label={t('console.mainModel')}>
                <span title={config.modelPath}>{modelName}</span>
              </InfoRow>
              <InfoRow label={t('console.visionModel')}>
                <span title={config.mmprojPath}>{mmprojName}</span>
              </InfoRow>
              <InfoRow label={t('console.fileSize')}>
                {fileVolume}
              </InfoRow>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('console.systemMonitor')}</CardTitle>
          <CardDescription>
            {t('console.monitorDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {metrics ? (
            <>
              {metrics.gpus.length > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {t('GPU：')}
                  {metrics.gpus.map((g) => g.name).join('、')}
                </p>
              )}
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricBar value={metrics.cpu_usage} label={t('console.cpuUsage')} />
                <MetricBar
                  value={
                    metrics.memory_total
                      ? (metrics.memory_used / metrics.memory_total) * 100
                      : 0
                  }
                  label={t('console.memory')}
                  detail={`${formatBytes(metrics.memory_used)} / ${formatBytes(metrics.memory_total)}`}
                />

                {metrics.gpus.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-muted-foreground">
                    {t('console.noGpu')}
                  </div>
                ) : (
                  metrics.gpus.map((gpu, i) => (
                    <React.Fragment key={i}>
                      <MetricBar
                        value={gpu.utilization ?? 0}
                        label={
                          metrics.gpus.length > 1
                            ? t('console.gpuUtilI', { i: i + 1 })
                            : t('console.gpuUtil')
                        }
                      />
                      <MetricBar
                        value={
                          gpu.memory_total && gpu.memory_used != null
                            ? (gpu.memory_used / gpu.memory_total) * 100
                            : 0
                        }
                        label={t('console.vram')}
                        detail={
                          gpu.memory_used != null && gpu.memory_total != null
                            ? `${formatBytes(gpu.memory_used)} / ${formatBytes(gpu.memory_total)}`
                            : '—'
                        }
                      />
                      <MetricBar
                        value={gpu.temperature != null ? gpu.temperature : 0}
                        label={t('settings.tempLabel')}
                        detail={gpu.temperature != null ? `${gpu.temperature} °C` : '—'}
                      />
                    </React.Fragment>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{t('console.readingHardware')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('console.liveLogs')}</CardTitle>
          <CardDescription>{t('console.lastN', { n: tail.length })}</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" render={<Link to="/logs" />}>
              {t('common.viewAll')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <LogView
            lines={tail}
            className="h-72"
            emptyHint={t('console.serviceStartLogHint')}
          />
        </CardContent>
      </Card>

      {dirty && (
        <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground">{t('common.paramsUnsaved')}</span>
          <Button variant="outline" onClick={() => void saveConfig()}>
            <Save />
            {t('common.save')}
          </Button>
        </div>
      )}
      </div>
      </ScrollArea>
    </div>
  )
}
