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

/** 带数值的进度条（CPU / 内存 / GPU 利用率 / 显存 / 温度 通用磁贴） */
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
  const modelName = config.modelPath ? fileNameOf(config.modelPath) : t('未选择')
  const modelSize = models.find((m) => m.path === config.modelPath)?.sizeBytes
  const mmprojName = config.mmprojPath ? fileNameOf(config.mmprojPath) : t('未启用')
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
            {status.running ? t('停止服务') : t('启动服务')}
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">

      {actionError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t('操作失败')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span className="whitespace-pre-wrap">{actionError}</span>
            <div>
              <Button variant="outline" size="sm" onClick={dismissError}>
                {t('知道了')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!config.modelPath && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{t('尚未选择主模型')}</AlertTitle>
          <AlertDescription>
            {t('请先到')}
            <Button variant="link" size="sm" render={<Link to="/models" />}>
              {t('模型')}
            </Button>
            {t('页面选择一个 GGUF 主模型。')}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('运行状态')}</CardTitle>
            <CardDescription>{t('进程信息与服务地址')}</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                disabled={!endpointUp || !config.webui}
                title={config.webui ? undefined : t('内置 Web UI 已在参数设置中关闭')}
                onClick={() => void api.openInShell(status.endpoint ?? endpoint)}
              >
                <ExternalLink />
                {t('打开 Web UI')}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <InfoRow label={t('服务地址')}>{endpoint}</InfoRow>
              <InfoRow label={t('进程 ID')}>{status.pid ?? '—'}</InfoRow>
              <InfoRow label={t('运行时长')}>{uptime}</InfoRow>
              <InfoRow label={t('退出码')}>
                {status.exitCode === null
                  ? '—'
                  : status.exitCode === 0
                    ? t('0（正常）')
                    : t('{code}（异常）', { code: status.exitCode })}
              </InfoRow>
              <InfoRow label={t('连续批处理')}>
                {config.contBatching ? t('启用') : t('禁用')}
              </InfoRow>
              <InfoRow label={t('上下文长度')}>
                {config.ctxSize.toLocaleString()} tokens
              </InfoRow>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('当前模型')}</CardTitle>
            <CardDescription>{t('主模型与视觉投影')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col">
              <InfoRow label={t('主模型')}>
                <span title={config.modelPath}>{modelName}</span>
              </InfoRow>
              <InfoRow label={t('视觉模型')}>
                <span title={config.mmprojPath}>{mmprojName}</span>
              </InfoRow>
              <InfoRow label={t('文件体积')}>
                {fileVolume}
              </InfoRow>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('系统监控')}</CardTitle>
          <CardDescription>
            {t('CPU / 内存 / GPU 利用率 / 显存 / 温度（每 2 秒刷新）')}
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
                <MetricBar value={metrics.cpu_usage} label={t('CPU 占用')} />
                <MetricBar
                  value={
                    metrics.memory_total
                      ? (metrics.memory_used / metrics.memory_total) * 100
                      : 0
                  }
                  label={t('内存')}
                  detail={`${formatBytes(metrics.memory_used)} / ${formatBytes(metrics.memory_total)}`}
                />

                {metrics.gpus.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-muted-foreground">
                    {t('未检测到 GPU')}
                  </div>
                ) : (
                  metrics.gpus.map((gpu, i) => (
                    <React.Fragment key={i}>
                      <MetricBar
                        value={gpu.utilization ?? 0}
                        label={
                          metrics.gpus.length > 1
                            ? t('GPU {i} 利用率', { i: i + 1 })
                            : t('GPU 利用率')
                        }
                      />
                      <MetricBar
                        value={
                          gpu.memory_total && gpu.memory_used != null
                            ? (gpu.memory_used / gpu.memory_total) * 100
                            : 0
                        }
                        label={t('显存')}
                        detail={
                          gpu.memory_used != null && gpu.memory_total != null
                            ? `${formatBytes(gpu.memory_used)} / ${formatBytes(gpu.memory_total)}`
                            : '—'
                        }
                      />
                      <MetricBar
                        value={gpu.temperature != null ? gpu.temperature : 0}
                        label={t('温度')}
                        detail={gpu.temperature != null ? `${gpu.temperature} °C` : '—'}
                      />
                    </React.Fragment>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{t('正在读取硬件信息…')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('实时日志')}</CardTitle>
          <CardDescription>{t('最近 {n} 行', { n: tail.length })}</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" render={<Link to="/logs" />}>
              {t('查看全部')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <LogView
            lines={tail}
            className="h-72"
            emptyHint={t('服务启动后将在此显示日志')}
          />
        </CardContent>
      </Card>

      {dirty && (
        <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground">{t('参数有未保存的修改')}</span>
          <Button variant="outline" onClick={() => void saveConfig()}>
            <Save />
            {t('保存参数')}
          </Button>
        </div>
      )}
      </div>
      </ScrollArea>
    </div>
  )
}
