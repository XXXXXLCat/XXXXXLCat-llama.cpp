import * as React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Boxes, Gauge, ScrollText, Settings2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLauncher } from '@/hooks/use-launcher'
import { api } from '@/lib/tauri-api'

const NAV = [
  { to: '/', label: '控制台', icon: Gauge, end: true },
  { to: '/models', label: '模型', icon: Boxes, end: false },
  { to: '/logs', label: '运行日志', icon: ScrollText, end: false },
  { to: '/settings', label: '参数设置', icon: Settings2, end: false },
] as const

const APP_NAME = 'XXXXXLCat-llama.cpp'

/** 品牌标记：用 favicon 的路径做遮罩，随侧边栏前景色变化（hover / 激活同步高亮） */
const LOGO_MASK: React.CSSProperties = {
  WebkitMaskImage: 'url(/favicon.svg)',
  maskImage: 'url(/favicon.svg)',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
}

/**
 * 侧边导航：竖向图标磁贴（图标 + 文字，正方形等宽），品牌标记置于底部。
 * 固定展开，无折叠控制。
 */
export function AppSidebar() {
  return (
    <div className="flex shrink-0 flex-row border-r border-sidebar-border bg-sidebar">
      <div className="flex w-20 flex-col">
        <nav className="flex flex-col">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex aspect-square w-full flex-col items-center justify-center gap-1.5 px-2 text-xs transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )
              }
            >
              <item.icon className="size-6" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <SidebarBrand />
      </div>
    </div>
  )
}

/**
 * 底部品牌标记：服务就绪时点击在系统浏览器打开 llama-server 的 Web UI，
 * 未就绪时回落到控制台页。
 */
function SidebarBrand() {
  const navigate = useNavigate()
  const { status, endpointUp, config } = useLauncher()
  const endpoint = status.endpoint
  // 关闭内置 Web UI（--no-webui）时服务端不提供页面，此时不应引导用户打开。
  const openable = Boolean(endpoint) && endpointUp && config.webui

  return (
    <button
      type="button"
      onClick={() => {
        if (openable && endpoint) void api.openInShell(endpoint)
        else navigate('/')
      }}
      title={openable ? `打开 Web UI（${endpoint}）` : `${APP_NAME}：服务未就绪，前往控制台`}
      aria-label={APP_NAME}
      className="group mt-auto flex h-20 w-full shrink-0 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      <div
        role="img"
        aria-label={APP_NAME}
        className="size-10 shrink-0 bg-current"
        style={LOGO_MASK}
      />
    </button>
  )
}
