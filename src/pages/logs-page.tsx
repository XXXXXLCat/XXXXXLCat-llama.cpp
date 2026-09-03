import * as React from 'react'
import { Copy, Search, Trash2 } from 'lucide-react'

import { LogView } from '@/components/log-view'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useLauncher } from '@/hooks/use-launcher'

const MAX_RENDERED = 1500

const STREAM_FILTERS = [
  { value: 'all', label: '全部输出' },
  { value: 'stdout', label: '标准输出' },
  { value: 'stderr', label: '标准错误' },
  { value: 'system', label: '启动器消息' },
]

export function LogsPage() {
  const { logs, clearLogs } = useLauncher()
  const [stream, setStream] = React.useState('all')
  const [keyword, setKeyword] = React.useState('')
  const [autoScroll, setAutoScroll] = React.useState(true)

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return logs.filter((line) => {
      if (stream !== 'all' && line.stream !== stream) return false
      if (kw && !line.text.toLowerCase().includes(kw)) return false
      return true
    })
  }, [logs, stream, keyword])

  const visible = React.useMemo(
    () => filtered.slice(-MAX_RENDERED),
    [filtered],
  )

  const copyAll = () => {
    const text = filtered
      .map((l) => `${new Date(l.ts).toLocaleTimeString()} [${l.stream}] ${l.text}`)
      .join('\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <h1 className="text-xl font-medium">运行日志</h1>
        <p className="text-muted-foreground">
          llama-server 进程输出与启动器消息，共 {logs.length} 行
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>日志输出</CardTitle>
          <CardDescription>
            显示最近 {visible.length} 行
            {filtered.length > MAX_RENDERED && `（共 ${filtered.length} 行匹配）`}
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Select value={stream} onValueChange={(v) => setStream(String(v))}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STREAM_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy />
              复制
            </Button>
            <Button variant="destructive" size="sm" onClick={clearLogs}>
              <Trash2 />
              清空
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
                placeholder="过滤日志内容"
                className="w-64 pl-7"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                size="sm"
                checked={autoScroll}
                onCheckedChange={setAutoScroll}
              />
              <span className="text-muted-foreground">自动滚动</span>
            </div>
          </div>

          <LogView
            lines={visible}
            autoScroll={autoScroll}
            className="h-[60vh] min-h-80"
            emptyHint="暂无日志，启动服务后将实时输出"
          />
        </CardContent>
      </Card>
    </div>
  )
}
