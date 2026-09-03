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
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { useI18n } from '@/lib/i18n'

const MAX_RENDERED = 1500

const STREAM_FILTERS = [
  { value: 'all', label: 'logs.all' },
  { value: 'stdout', label: 'logs.stdout' },
  { value: 'stderr', label: 'logs.stderr' },
  { value: 'system', label: 'logs.launcher' },
]

export function LogsPage() {
  const { t } = useI18n()
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
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-3">
      <Card>
        <CardHeader>
          <CardTitle>{t('logs.output')}</CardTitle>
          <CardDescription>
            {t('logs.showLastN', { n: visible.length })}
            {filtered.length > MAX_RENDERED &&
              t('logs.matchedN', { n: filtered.length })}
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Select value={stream} onValueChange={(v) => setStream(String(v))}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STREAM_FILTERS.map((f) => (
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
            <div className="flex items-center gap-2">
              <Switch
                size="sm"
                checked={autoScroll}
                onCheckedChange={setAutoScroll}
              />
              <span className="text-muted-foreground">{t('common.autoScroll')}</span>
            </div>
          </div>

          <LogView
            lines={visible}
            autoScroll={autoScroll}
            className="h-[60vh] min-h-80"
            emptyHint={t('logs.emptyHint')}
          />
        </CardContent>
      </Card>
      </div>
      </ScrollArea>
    </div>
  )
}
