import * as React from 'react'

import { cn } from '@/lib/utils'

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
}

/**
 * 使用common.browse器原生滚动 + CSS 细滚动条。
 *
 * 原 `@base-ui/react/scroll-area` 通过 React 自定义 thumb/scrollbar，
 * 但在当前 WebView2 环境下无法显示滚动条，导致页面内容无法滚动。
 * 这里改回原生 `overflow-y-auto` 并挂 `custom-scrollbar` 样式类，
 * 保证滚动条始终可见、跨主题清晰，并保留 shadcn 风格的细滑块prefs.appearance。
 */
function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        'custom-scrollbar relative overflow-y-auto overflow-x-hidden',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// 旧接口保留占位（未被项目引用），避免签名突然缺失。
function ScrollBar() {
  return null
}

export { ScrollArea, ScrollBar }
