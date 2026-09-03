export type ThemeName =
  | 'neutral'
  | 'stone'
  | 'zinc'
  | 'mauve'
  | 'olive'
  | 'mist'
  | 'taupe'

export type ThemeMode = 'light' | 'dark'

export const THEMES: ThemeName[] = [
  'neutral',
  'stone',
  'zinc',
  'mauve',
  'olive',
  'mist',
  'taupe',
]

export const THEME_LABELS: Record<ThemeName, string> = {
  neutral: 'Neutral',
  stone: 'Stone',
  zinc: 'Zinc',
  mauve: 'Mauve',
  olive: 'Olive',
  mist: 'Mist',
  taupe: 'Taupe',
}

const THEME_KEY = 'shadcn-theme'
const MODE_KEY = 'shadcn-mode'

export function getStoredTheme(): ThemeName {
  const t = localStorage.getItem(THEME_KEY) as ThemeName | null
  return t && THEMES.includes(t) ? t : 'neutral'
}

export function setTheme(theme: ThemeName) {
  localStorage.setItem(THEME_KEY, theme)
  document.documentElement.setAttribute('data-theme', theme)
}

export function getStoredMode(): ThemeMode {
  const m = localStorage.getItem(MODE_KEY) as ThemeMode | null
  if (m === 'light' || m === 'dark') return m
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function setMode(mode: ThemeMode) {
  localStorage.setItem(MODE_KEY, mode)
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

/** 应用启动时的初始主题（在 React 挂载前调用，避免闪烁） */
export function applyInitialTheme() {
  setTheme(getStoredTheme())
  setMode(getStoredMode())
}
