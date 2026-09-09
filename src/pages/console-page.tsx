import * as React from 'react'
import {
  Copy,
  ExternalLink,
  Play,
  Search,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNavigate } from 'react-router-dom'
import { LogView } from '@/components/log-view'
import { useLauncher } from '@/hooks/use-launcher'
import { useI18n } from '@/lib/i18n'
import { api, endpointUrl, fileNameOf, formatBytes, formatDuration } from '@/lib/tauri-api'

const LOG_MAX_RENDERED = 1500

const LOG_STREAM_FILTERS = [
  { value: 'all', label: 'logs.all' },
  { value: 'stdout', label: 'logs.stdout' },
  { value: 'stderr', label: 'logs.stderr' },
  { value: 'system', label: 'logs.launcher' },
]

/** 实时日志输出卡片（原「日志」标签页内容，现内嵌于概览）。 */
function LogOutputCard() {
  const { t } = useI18n()
  const { logs, clearLogs } = useLauncher()
  const [stream, setStream] = React.useState('all')
  const [keyword, setKeyword] = React.useState('')

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return logs.filter((line) => {
      if (stream !== 'all' && line.stream !== stream) return false
      if (kw && !line.text.toLowerCase().includes(kw)) return false
      return true
    })
  }, [logs, stream, keyword])

  const visible = React.useMemo(() => filtered.slice(-LOG_MAX_RENDERED), [filtered])

  const copyAll = () => {
    const text = filtered
      .map((l) => `${new Date(l.ts).toLocaleTimeString()} [${l.stream}] ${l.text}`)
      .join('\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('logs.output')}</CardTitle>
        <CardDescription>
          {t('logs.showLastN', { n: visible.length })}
          {filtered.length > LOG_MAX_RENDERED && t('logs.matchedN', { n: filtered.length })}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2 pl-3">
          <Select value={stream} onValueChange={(v) => setStream(String(v))}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_STREAM_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {t(f.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={copyAll}>
            <Copy />
            {t('common.copy')}
          </Button>
          <Button variant="destructive" size="sm" onClick={clearLogs}>
            <Trash2 />
            {t('common.clear')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('common.filterLog')}
              className="w-64 pl-7"
            />
          </div>
        </div>

        <LogView
          lines={visible}
          autoScroll={false}
          className="h-[60vh] min-h-80"
          emptyHint={t('logs.emptyHint')}
        />
      </CardContent>
    </Card>
  )
}

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

/** 控制台概览：服务控制、运行状态、当前模型、系统监控。 */
function ConsoleOverview() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const {
    config,
    status,
    metrics,
    busy,
    actionError,
    startServer,
    stopServer,
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
  const mmprojName = config.mmprojPath ? fileNameOf(config.mmprojPath) : t('common.notEnabled')
  const draftName = config.draftModelPath ? fileNameOf(config.draftModelPath) : t('common.notEnabled')
  const endpoint = endpointUrl(config.host, config.port)

  return (
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
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('console.pickModelHint')}</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => navigate('/models')}
            >
              {t('nav.models')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('console.runtimeStatus')}</CardTitle>
            <CardDescription>{t('console.processInfo')}</CardDescription>
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
                {config.contBatching === true
                  ? t('common.enabled')
                  : config.contBatching === false
                    ? t('common.disabled')
                    : t('common.auto')}
              </InfoRow>
              <InfoRow label={t('console.contextLength')}>
                {config.ctxSize === null
                  ? t('common.unset')
                  : `${config.ctxSize.toLocaleString()} tokens`}
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
              <InfoRow label={t('console.draftModel')}>
                <span title={config.draftModelPath}>{draftName}</span>
              </InfoRow>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('console.systemMonitor')}</CardTitle>
          <CardDescription>{t('console.monitorDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics ? (
            <>
              {metrics.gpus.length > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {t('console.gpu')}
                  {metrics.gpus.map((g) => g.name).join('、')}
                </p>
              )}
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricBar
                  value={metrics.cpu_usage}
                  label={t('console.cpuUsage')}
                />
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground">{t('console.cpuSpec')}</span>
                    <span className="tabular-nums text-sm">
                      {metrics.cpu_count
                        ? metrics.cpu_physical_count
                          ? t('console.cpuCores', {
                              cores: metrics.cpu_physical_count,
                              threads: metrics.cpu_count,
                            })
                          : t('console.cpuThreads', { threads: metrics.cpu_count })
                        : '—'}
                    </span>
                  </div>
                </div>
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

      <LogOutputCard />
    </div>
  )
}

export function ConsolePage() {
  const { t } = useI18n()
  const { status, busy, config, endpointUp, startServer, stopServer } = useLauncher()

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!endpointUp || config.webui === false}
            title={config.webui === false ? t('settings.webuiDisabledHint') : undefined}
            onClick={() => void api.openInShell(status.endpoint ?? endpointUrl(config.host, config.port))}
          >
            <ExternalLink />
            {t('console.openWebUI')}
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConsoleOverview />
      </div>
    </div>
  )
}
