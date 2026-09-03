import { Route, Routes } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'

import { AppSidebar } from '@/components/app-sidebar'
import { TitleBar } from '@/components/title-bar'
import { LauncherProvider, useLauncher } from '@/hooks/use-launcher'
import { ConsolePage } from '@/pages/console-page'
import { LogsPage } from '@/pages/logs-page'
import { ModelsPage } from '@/pages/models-page'
import { SettingsPage } from '@/pages/settings-page'

function BootScreen() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <span className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          正在读取配置…
        </span>
      </div>
    </div>
  )
}

function Shell() {
  const { status, endpointUp } = useLauncher()

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TitleBar status={status} endpointUp={endpointUp} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<ConsolePage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <LauncherProvider fallback={<BootScreen />}>
      <Shell />
    </LauncherProvider>
  )
}
