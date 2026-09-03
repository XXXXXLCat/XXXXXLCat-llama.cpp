import * as React from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Play, Save, Square, TriangleAlert } from 'lucide-react'

import { LogView } from '@/components/log-view'
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
import { Separator } from '@/components/ui/separator'
import { useLauncher } from '@/hooks/use-launcher'
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
    mmprojMatch,
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
  const modelName = config.modelPath ? fileNameOf(config.modelPath) : '未选择'
  const modelSize = models.find((m) => m.path === config.modelPath)?.sizeBytes
  const mmprojName = config.mmprojPath ? fileNameOf(config.mmprojPath) : '未启用'
  const endpoint = endpointUrl(config.host, config.port)
  const tail = React.useMemo(() => logs.slice(-80), [logs])

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium">控制台</h1>
          <p className="text-muted-foreground">
            启动或停止 llama.cpp 服务，并查看模型与运行时状态
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={status.running ? 'destructive' : 'default'}
            onClick={() => void (status.running ? stopServer() : startServer())}
            disabled={busy || (!status.running && !config.modelPath)}
          >
            {status.running ? <Square /> : <Play />}
            {status.running ? '停止服务' : '启动服务'}
          </Button>
        </div>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span className="whitespace-pre-wrap">{actionError}</span>
            <div>
              <Button variant="outline" size="sm" onClick={dismissError}>
                知道了
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!config.modelPath && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>尚未选择主模型</AlertTitle>
          <AlertDescription>
            请先到
            <Button variant="link" size="sm" render={<Link to="/models" />}>
              模型
            </Button>
            页面选择一个 GGUF 主模型。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>运行状态</CardTitle>
            <CardDescription>进程信息与服务地址</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                disabled={!endpointUp || !config.webui}
                title={config.webui ? undefined : '内置 Web UI 已在参数设置中关闭'}
                onClick={() => void api.openInShell(status.endpoint ?? endpoint)}
              >
                <ExternalLink />
                打开 Web UI
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <InfoRow label="服务地址">{endpoint}</InfoRow>
              <InfoRow label="进程 ID">{status.pid ?? '—'}</InfoRow>
              <InfoRow label="运行时长">{uptime}</InfoRow>
              <InfoRow label="退出码">
                {status.exitCode === null
                  ? '—'
                  : status.exitCode === 0
                    ? '0（正常）'
                    : `${status.exitCode}（异常）`}
              </InfoRow>
              <InfoRow label="连续批处理">
                {config.contBatching ? '启用' : '禁用'}
              </InfoRow>
              <InfoRow label="上下文长度">
                {config.ctxSize.toLocaleString()} tokens
              </InfoRow>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>当前模型</CardTitle>
            <CardDescription>主模型与视觉投影</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col">
              <InfoRow label="主模型">
                <span title={config.modelPath}>{modelName}</span>
              </InfoRow>
              <InfoRow label="文件体积">
                {modelSize ? formatBytes(modelSize) : '—'}
              </InfoRow>
              <Separator className="my-1" />
              <InfoRow label="视觉模型">
                <span title={config.mmprojPath}>{mmprojName}</span>
              </InfoRow>
              <InfoRow label="匹配方式">
                {!config.mmprojPath
                  ? '—'
                  : config.autoMmproj
                    ? `自动（${mmprojMatch?.confidence ?? '—'}）`
                    : '手动指定'}
              </InfoRow>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>系统监控</CardTitle>
          <CardDescription>CPU / 内存 / GPU 利用率 / 显存 / 温度（每 2 秒刷新）</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics ? (
            <>
              {metrics.gpus.length > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  GPU：{metrics.gpus.map((g) => g.name).join('、')}
                </p>
              )}
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricBar value={metrics.cpu_usage} label="CPU 占用" />
                <MetricBar
                  value={
                    metrics.memory_total
                      ? (metrics.memory_used / metrics.memory_total) * 100
                      : 0
                  }
                  label="内存"
                  detail={`${formatBytes(metrics.memory_used)} / ${formatBytes(metrics.memory_total)}`}
                />

                {metrics.gpus.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-muted-foreground">
                    未检测到 GPU
                  </div>
                ) : (
                  metrics.gpus.map((gpu, i) => (
                    <React.Fragment key={i}>
                      <MetricBar
                        value={gpu.utilization ?? 0}
                        label={metrics.gpus.length > 1 ? `GPU ${i + 1} 利用率` : 'GPU 利用率'}
                      />
                      <MetricBar
                        value={
                          gpu.memory_total && gpu.memory_used != null
                            ? (gpu.memory_used / gpu.memory_total) * 100
                            : 0
                        }
                        label="显存"
                        detail={
                          gpu.memory_used != null && gpu.memory_total != null
                            ? `${formatBytes(gpu.memory_used)} / ${formatBytes(gpu.memory_total)}`
                            : '—'
                        }
                      />
                      <MetricBar
                        value={gpu.temperature != null ? gpu.temperature : 0}
                        label="温度"
                        detail={gpu.temperature != null ? `${gpu.temperature} °C` : '—'}
                      />
                    </React.Fragment>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">正在读取硬件信息…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>实时日志</CardTitle>
          <CardDescription>最近 {tail.length} 行</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" render={<Link to="/logs" />}>
              查看全部
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <LogView lines={tail} className="h-72" emptyHint="服务启动后将在此显示日志" />
        </CardContent>
      </Card>

      {dirty && (
        <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground">参数有未保存的修改</span>
          <Button variant="outline" onClick={() => void saveConfig()}>
            <Save />
            保存参数
          </Button>
        </div>
      )}
    </div>
  )
}
