import * as React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Gauge, Package, Settings, SlidersHorizontal } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

const NAV = [
  { to: '/', label: 'nav.console', icon: Gauge, end: true },
  { to: '/settings', label: 'nav.parameters', icon: SlidersHorizontal, end: false },
  { to: '/models', label: 'nav.models', icon: Package, end: false },
  { to: '/preferences', label: 'nav.preferences', icon: Settings, end: false },
] as const

const APP_NAME = 'XXXXXLCat-llama.cpp'

/**
 * 侧边导航：竖向图标磁贴（图标 + 文字，正方形等宽），品牌标记置于底部。
 * 固定展开，无折叠控制。
 */
export function AppSidebar() {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 flex-row border-r border-sidebar-border bg-sidebar">
      <div className="flex w-20 flex-col">
        <nav className="flex flex-1 flex-col gap-0 overflow-y-auto pb-2 pt-0">
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
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>

        <SidebarBrand />
      </div>
    </div>
  )
}

/**
 * 底部品牌标记：用 Avatar（lg）展示 Localstudio 图标，点击进入 WebUI（/webui）。
 */
function SidebarBrand() {
  const navigate = useNavigate()
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => navigate('/webui')}
      title={t('nav.webui')}
      aria-label={APP_NAME}
      className="group mt-auto flex h-20 w-full shrink-0 items-center justify-center transition-colors hover:bg-sidebar-accent"
    >
      <Avatar size="lg" className="size-12">
        <AvatarImage src="/logo-localstudio.png" alt={APP_NAME} />
        <AvatarFallback>{APP_NAME.slice(0, 1)}</AvatarFallback>
      </Avatar>
    </button>
  )
}
