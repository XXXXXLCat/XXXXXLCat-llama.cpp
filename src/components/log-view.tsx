import * as React from 'react'

import { formatTime, type LogLine } from '@/lib/tauri-api'
import { useI18n } from '@/lib/i18n'

function isErrorLine(text: string) {
  const t = text.toLowerCase()
  return t.includes('error') || t.includes('failed') || t.includes('fatal')
}

export function LogView({
  lines,
  autoScroll = true,
  showTimestamps = true,
  className,
  emptyHint = 'logs.empty',
}: {
  lines: LogLine[]
  autoScroll?: boolean
  showTimestamps?: boolean
  className?: string
  emptyHint?: string
}) {
  const { t } = useI18n()
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [lines, autoScroll])

  if (lines.length === 0) {
    return (
      <div
        className={`flex min-h-24 items-center justify-center rounded-lg border bg-muted/40 p-4 ${className ?? ''}`}
      >
        <p className="text-muted-foreground">{t(emptyHint)}</p>
      </div>
    )
  }

  return (
    <div
      className={`overflow-y-auto rounded-lg border bg-muted/40 ${className ?? ''}`}
      // The terminal-style region is the documented exception to the default
      // typography rules (monospace + small size).
      data-slot="log-view"
    >
      <div className="p-3 font-mono text-xs leading-relaxed">
        {lines.map((line) => (
          <div key={line.id} className="flex gap-2 whitespace-pre-wrap break-all">
            {showTimestamps && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatTime(line.ts)}
              </span>
            )}
            {line.stream === 'system' ? (
              <span className="shrink-0 text-muted-foreground">{t('log.launcherTag')}</span>
            ) : (
              <span className="shrink-0 text-muted-foreground">
                [{line.stream === 'stderr' ? 'err' : 'out'}]
              </span>
            )}
            <span className={isErrorLine(line.text) ? 'text-destructive' : undefined}>
              {line.text}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
