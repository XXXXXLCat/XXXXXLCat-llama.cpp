import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export function ThemeSwitcher() {
  const [theme, setCurTheme] = useState<ThemeName>(() => getStoredTheme())
  const [mode, setCurMode] = useState<ThemeMode>(() => getStoredMode())

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 rounded-full border bg-background p-1.5">
        {THEMES.map((t) => (
          <button
            key={t}
            type="button"
            title={THEME_LABELS[t]}
            aria-label={`Switch to ${THEME_LABELS[t]} theme`}
            onClick={() => {
              setTheme(t)
              setCurTheme(t)
            }}
            className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
              theme === t
                ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                : ''
            }`}
            style={{ backgroundColor: SWATCH[t] }}
          />
        ))}
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="Toggle light/dark mode"
        onClick={() => {
          const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'
          setMode(next)
          setCurMode(next)
        }}
      >
        {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </div>
  )
}
