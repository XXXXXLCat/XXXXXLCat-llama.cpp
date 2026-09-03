import * as React from 'react'
import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useI18n, LOCALES, type LocalePref } from '@/lib/i18n'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export function PreferencesPage() {
  const { t, pref, setLocale } = useI18n()
  const [theme, setCurTheme] = React.useState<ThemeName>(() => getStoredTheme())
  const [mode, setCurMode] = React.useState<ThemeMode>(() => getStoredMode())

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
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
      </div>
      </ScrollArea>
    </div>
  )
}
