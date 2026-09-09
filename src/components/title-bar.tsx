import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Minus, Square, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { StatusPill } from '@/components/status-pill'
import { cn } from '@/lib/utils'
import { isTauriRuntime } from '@/lib/tauri-mock'
import { useI18n } from '@/lib/i18n'
import type { ServerStatus } from '@/lib/tauri-api'

const APP_NAME = 'XXXXXLCat-llama.cpp'

/**
 * 自定义标题栏：窗口 `decorations: false` 后由前端自绘。
 * - 整条为拖动区（在空区域按下左键调用 `startDragging`，双击titlebar.maximize/还原）；
 * - 软件名右侧嵌入console.runtimeStatus徽标，点击跳转「nav.console」页；
 * - 右侧为titlebar.minimize / titlebar.maximize(还原) / common.close，均为非拖动区；
 * - 纯common.browse器（`vite dev` 预览）下窗口控制自动降级为无操作，不抛错。
 */
export function TitleBar({
  status,
  endpointUp,
}: {
  /** 未提供时（配置尚未读取完成）不渲染状态徽标 */
  status?: ServerStatus
  endpointUp?: boolean
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [maximized, setMaximized] = React.useState(false)

  // 同步titlebar.maximize状态：跟随窗口尺寸变化更新图标（titlebar.maximize→还原）
  React.useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const win = getCurrentWindow()
        if (!disposed) setMaximized(await win.isMaximized())
        unlisten = await win.onResized(() => {
          void win.isMaximized().then((m) => {
            if (!disposed) setMaximized(m)
          })
        })
      } catch {
        // 非 Tauri 环境忽略
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const control = React.useCallback(
    (fn: (win: ReturnType<typeof getCurrentWindow>) => void) => {
      if (!isTauriRuntime()) return
      try {
        fn(getCurrentWindow())
      } catch {
        // common.browse器预览环境无窗口可操作
      }
    },
    [],
  )

  const winButton = (
    icon: React.ReactNode,
    title: string,
    fn: () => void,
    extra?: string,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={fn}
      className={cn(
        'flex h-full w-11 cursor-default items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
        extra,
      )}
    >
      {icon}
    </button>
  )

  // 在标题栏空区域按下左键拖动窗口（程序化调用，比原生 data-tauri-drag-region
  // 更稳定，且不会与窗口控制按钮冲突）。
  const onBarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    if (!isTauriRuntime()) return
    try {
      void getCurrentWindow().startDragging()
    } catch {
      // common.browse器预览环境无窗口可操作
    }
  }

  const onBarDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    control((win) => {
      void win.toggleMaximize()
    })
  }

  return (
    <div
      onMouseDown={onBarMouseDown}
      onDoubleClick={onBarDoubleClick}
      className="flex h-9 shrink-0 select-none cursor-default items-center border-b bg-background pl-3"
    >
      <span className="text-xs font-medium text-muted-foreground">{APP_NAME}</span>

      {status ? (
        <button
          type="button"
          title={t('nav.console')}
          aria-label={t('nav.console')}
          onClick={() => navigate('/')}
          className="ml-3 inline-flex cursor-default items-center transition-opacity hover:opacity-80"
        >
          <StatusPill status={status} endpointUp={endpointUp ?? false} />
        </button>
      ) : null}

      <div className="ml-auto flex h-full">
        {winButton(<Minus className="size-4" />, t('titlebar.minimize'), () =>
          control((win) => {
            void win.minimize()
          }),
        )}
        {winButton(
          maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />,
          maximized ? t('titlebar.restore') : t('titlebar.maximize'),
          () =>
            control((win) => {
              void win.toggleMaximize()
            }),
        )}
        {winButton(
          <X className="size-4" />,
          t('common.close'),
          () =>
            control((win) => {
              void win.close()
            }),
          'hover:bg-destructive hover:text-destructive-foreground',
        )}
      </div>
    </div>
  )
}
