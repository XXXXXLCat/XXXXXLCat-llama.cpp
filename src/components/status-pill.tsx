import { LoaderCircle, Square } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'
import type { ServerStatus } from '@/lib/tauri-api'

export type ServerPhase = 'idle' | 'starting' | 'ready'

export function serverPhase(status: ServerStatus, endpointUp: boolean): ServerPhase {
  if (!status.running) {
    return 'idle'
  }
  return endpointUp ? 'ready' : 'starting'
}

const PHASE_META: Record<
  ServerPhase,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: typeof Square | null }
> = {
  idle: { label: 'llama.cpp 未启动', variant: 'destructive', icon: null },
  starting: { label: '模型加载中', variant: 'secondary', icon: LoaderCircle },
  ready: { label: 'llama.cpp 运行中', variant: 'default', icon: LoaderCircle },
}


export function StatusPill({
  status,
  endpointUp,
}: {
  status: ServerStatus
  endpointUp: boolean
}) {
  const { t } = useI18n()
  const phase = serverPhase(status, endpointUp)
  const meta = PHASE_META[phase]
  const Icon = meta.icon

  return (
    <Badge variant={meta.variant}>
      {Icon ? <Icon className={phase === 'idle' ? undefined : 'animate-spin'} /> : null}
      {t(meta.label)}
    </Badge>
  )
}
