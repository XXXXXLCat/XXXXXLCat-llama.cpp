import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useI18n, HTML_LANG } from '@/lib/i18n'
import { useLauncher } from '@/hooks/use-launcher'
import { endpointUrl, formatBytes } from '@/lib/tauri-api'

/**
 * 在应用内嵌入 llama.cpp 自带的 Web UI（挂在 server 根路径 http://{host}:{port}/）。
 * - Web UI 在参数设置中关闭时：提示去开启。
 * - server 未运行时：提示并允许一键启动。
 * - server 运行中：iframe 内嵌。
 * 「在浏览器中打开」由控制台页的「打开 WebUI」按钮负责，此处不再重复。
 */
export function WebuiPage() {
  const { t, resolved } = useI18n()
  const navigate = useNavigate()
  const { config, status, busy, startServer, metrics } = useLauncher()

  // 把宿主界面语言拼进 iframe src 的 ?lang 参数，注入脚本直接读 location.search 即可翻译，
  // 不再依赖跨窗 postMessage 时序（避免信号丢失导致整页不翻）。
  // 同时保留 postMessage 作为运行期切换语言的备用通道。
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const langRef = React.useRef(resolved)
  langRef.current = resolved

  const dev = import.meta.env.DEV
  // dev 下：先把「参数设置」里的真实 server 地址同步给 Vite 的 /llama 代理
  // （代理默认写死 127.0.0.1:8080，用户一改地址注入/加载就会失败）。
  const [proxyReady, setProxyReady] = React.useState(!dev)

  const sendLang = React.useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ __webuiI18n: 'set-lang', lang: HTML_LANG[langRef.current] ?? langRef.current }, '*')
  }, [])

  // 注入脚本就绪后会发 ready，此时立即回发一次语言（避免 iframe 先于脚本加载完成）
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data && e.data.__webuiI18n === 'ready') sendLang()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sendLang])

  // 用户在偏好设置里改语言后即时下发（脚本会原地还原上一语言再应用新语言）
  React.useEffect(() => {
    sendLang()
  }, [resolved, sendLang])

  // iframe 走本地反向代理：开发环境经 vite `/llama`（注入翻译脚本），
  // 生产环境经 Rust 代理（默认 127.0.0.1:18080，由 server.rs 启动并转发到 llama-server）。
  // 把宿主界面语言拼进 ?lang，注入脚本据此决定翻译哪种语言（英语则保持官方原版）。
  const base = import.meta.env.DEV ? '/llama/' : 'http://127.0.0.1:18080/'
  const url = base + '?lang=' + encodeURIComponent(HTML_LANG[resolved] ?? resolved)
  const webuiEnabled = config?.webui ?? true
  const running = status.running

  // dev：每次 server 运行态或地址配置变化时，把目标地址推给 Vite 中间件，
  // 代理据此转发到真实 llama-server（生产环境走 Rust 代理，无需此步）。
  React.useEffect(() => {
    if (!dev || !running || !webuiEnabled) return
    const target = endpointUrl(config?.host ?? '127.0.0.1', config?.port ?? 8080)
    let cancelled = false
    fetch('/__llama_target', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProxyReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [dev, running, webuiEnabled, config?.host, config?.port])

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 空状态 Hero：完全照搬 Launcher hero 区域结构 */}
      {(!running || !webuiEnabled) && (
        <div className="relative flex h-full flex-col justify-between gap-3 overflow-hidden bg-gradient-to-br from-muted/50 to-background p-8">
          {/* 装饰性大 logo：与 Launcher hero 完全一致——右上角、600px、倾斜 15°、mask 遮罩 */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 bottom-[5px] size-[600px] rotate-[-15deg] bg-foreground/[0.05]"
            style={{
              WebkitMaskImage: 'url(/logo.svg)',
              maskImage: 'url(/logo.svg)',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />

          {/* 顶部：Hero 文字（与 Launcher hero 一致：h1 大标题 + tagline 副文案） */}
          <div className="relative flex flex-1 flex-col justify-center">
            <h1 className="mb-3 text-4xl font-bold tracking-tight">{t('about.name')}</h1>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">{t('webui.tagline')}</p>
            {!running && (
              <Button
                className="w-fit self-start"
                onClick={() => void startServer()}
                disabled={busy || !config?.modelPath}
              >
                <Play />
                {t('console.startServer')}
              </Button>
            )}
          </div>

          {/* 底部规格信息：与 Launcher hero 底部版本号完全一致（text-xs 单列、标签值内联、无加粗） */}
          {metrics && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <p>{t('about.name')}: {metrics.app_version}</p>
              <p>llama.cpp: {metrics.llama_version ?? 'Unknown'}</p>
              <p>CPU: {metrics.cpu_name}</p>
              <p>
                GPU:{' '}
                {metrics.gpus.length > 0
                  ? `${metrics.gpus[0].name}${metrics.gpus[0].memory_total != null ? `（${formatBytes(metrics.gpus[0].memory_total)}）` : ''}`
                  : 'None'}
              </p>
              <p>Memory: {formatBytes(metrics.memory_total)}</p>
            </div>
          )}
        </div>
      )}

      {!webuiEnabled ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <AlertTriangle className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('settings.webuiDisabledHint')}</p>
            <Button variant="outline" onClick={() => navigate('/settings')}>
              {t('nav.parameters')}
            </Button>
          </div>
        </div>
      ) : !running ? null : (
        <div className="relative z-10 h-full w-full">
          {proxyReady ? (
            <iframe
              ref={iframeRef}
              src={url}
              title="llama.cpp WebUI"
              className="h-full w-full border-0"
              // 跨域 iframe 的 Permissions Policy 默认禁止剪贴板：
              // 生产下 iframe 源是 http://127.0.0.1:18080，父页是 tauri://localhost，
              // 二者不同源，llama.cpp 内复制会报 "Failed to copy to clipboard"。
              // 这里显式把剪贴板读写权限委托给 iframe 自身源（等价于 'src'）。
              // dev 走同源的 /llama/ 代理、外部浏览器是顶层页面，均不受此限制，
              // 因此该问题只在生产内嵌时暴露。
              allow="clipboard-read; clipboard-write"
              onLoad={sendLang}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
