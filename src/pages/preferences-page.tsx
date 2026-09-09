import * as React from 'react'
import { Moon, Sun, Info } from 'lucide-react'
import { getVersion } from '@tauri-apps/api/app'

import { cn } from '@/lib/utils'
import { useI18n, LOCALES, type LocalePref } from '@/lib/i18n'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  THEMES,
  THEME_LABELS,
  getStoredTheme,
  getStoredMode,
  setTheme,
  setMode,
  type ThemeMode,
  type ThemeName,
} from '@/lib/theme'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useLauncher } from '@/hooks/use-launcher'

/** 每个主题的代表色（色块预览用） */
const SWATCH: Record<ThemeName, string> = {
  neutral: '#a3a3a3',
  stone: '#a8a29e',
  zinc: '#8b8f9a',
  mauve: '#9d7fd4',
  olive: '#8f9a6b',
  mist: '#7f9bbf',
  taupe: '#99897d',
}

/** 关于弹窗：应用版本兜底值（Tauri 不可用时使用，如浏览器预览） */
const APP_VERSION_FALLBACK = '0.1.2'

/** 关于弹窗：技术栈 chips（固定技术名，无需 i18n） */
const TECH_STACK = ['Vite', 'React', 'Tauri 2', 'shadcn UI']

export function PreferencesPage() {
  const { t, pref, setLocale } = useI18n()
  const { config, applyConfig, flushConfigSave } = useLauncher()
  const [theme, setCurTheme] = React.useState<ThemeName>(() => getStoredTheme())
  const [mode, setCurMode] = React.useState<ThemeMode>(() => getStoredMode())
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const [appVersion, setAppVersion] = React.useState<string>(APP_VERSION_FALLBACK)

  // 取真实版本（编译期 CARGO_PKG_VERSION）；浏览器预览无 Tauri 时回退兜底值
  React.useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(APP_VERSION_FALLBACK))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3">
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setAboutOpen(true)}>
            <Info />
            {t('prefs.tab.about')}
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <Card>
            <CardHeader>
              <CardTitle>{t('prefs.language')}</CardTitle>
              <CardDescription>{t('prefs.languageDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                value={pref === 'system' ? 'system' : pref}
                onValueChange={(v) => setLocale(v as LocalePref)}
              >
                <TabsList>
                  {LOCALES.map((loc) => (
                    <TabsTrigger key={loc.value} value={loc.value}>
                      {loc.value === 'system' ? t('common.followSystem') : loc.endonym}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('prefs.appearance')}</CardTitle>
              <CardDescription>{t('prefs.appearanceDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-row flex-wrap items-center gap-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {THEMES.map((th) => (
                    <button
                      key={th}
                      type="button"
                      title={THEME_LABELS[th]}
                      aria-label={THEME_LABELS[th]}
                      onClick={() => {
                        setTheme(th)
                        setCurTheme(th)
                      }}
                      className={cn(
                        'h-7 w-7 rounded-full transition-transform hover:scale-110',
                        theme === th
                          ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                          : '',
                      )}
                      style={{ backgroundColor: SWATCH[th] }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Tabs
                  value={mode}
                  onValueChange={(v) => {
                    const m = v as ThemeMode
                    setMode(m)
                    setCurMode(m)
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="light">
                      <Sun className="size-4" />
                      {t('prefs.light')}
                    </TabsTrigger>
                    <TabsTrigger value="dark">
                      <Moon className="size-4" />
                      {t('prefs.dark')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.serverNet')}</CardTitle>
              <CardDescription>{t('settings.serverNetDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="listen-addr">{t('settings.listenAddr')}</FieldLabel>
                <Input
                  id="listen-addr"
                  value={config.host}
                  onChange={(e) => applyConfig({ host: e.target.value })}
                  onBlur={flushConfigSave}
                />
                <FieldDescription>{t('settings.listenAddrDesc')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="listen-port">{t('settings.port')}</FieldLabel>
                <Input
                  id="listen-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={config.port}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    applyConfig({ port: Number.isFinite(v) ? Math.round(v) : 0 })
                  }}
                  onBlur={flushConfigSave}
                />
                <FieldDescription>{t('settings.portDesc')}</FieldDescription>
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('prefs.tab.about')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 px-2 pb-2 text-center">
            <img
              src="/logo.png"
              alt="XXXXXLCat-llama.cpp"
              className="size-16 object-contain"
            />
            <div className="flex flex-col gap-1.5">
              <h2 className="text-2xl font-bold tracking-tight">{t('about.name')}</h2>
              <p className="text-xs text-muted-foreground">{t('about.tagline')}</p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1 text-xs font-medium tabular-nums text-foreground/80">
              <span aria-hidden className="size-1.5 rounded-full bg-foreground/50" />
              {t('about.versionPrefix')}
              {appVersion}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {TECH_STACK.map((tech) => (
                <span
                  key={tech}
                  className="rounded-full bg-foreground/5 px-2.5 py-0.5 text-[10px] text-foreground/70 ring-1 ring-inset ring-foreground/10"
                >
                  {tech}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              {t('about.copyright')}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
