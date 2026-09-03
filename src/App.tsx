import { Route, Routes } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'

import { AppSidebar } from '@/components/app-sidebar'
import { TitleBar } from '@/components/title-bar'
import { LauncherProvider, useLauncher } from '@/hooks/use-launcher'
import { ConsolePage } from '@/pages/console-page'
import { LogsPage } from '@/pages/logs-page'
import { ModelsPage } from '@/pages/models-page'
import { PreferencesPage } from '@/pages/preferences-page'
import { SettingsPage } from '@/pages/settings-page'
import { ChatPage } from '@/pages/chat-page'
import { LocaleProvider, useI18n } from '@/lib/i18n'

function BootScreen() {
  const { t } = useI18n()
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <span className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          {t('app.loadingConfig')}
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
        <main className="min-h-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<ConsolePage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <LocaleProvider>
      <LauncherProvider fallback={<BootScreen />}>
        <Shell />
      </LauncherProvider>
    </LocaleProvider>
  )
}
