import * as React from 'react'

import { EN } from './i18n/en'
import { ZH } from './i18n/zh'
import { ZH_TW } from './i18n/zh-TW'
import { JA } from './i18n/ja'
import { KO } from './i18n/ko'
import { FR } from './i18n/fr'
import { RU } from './i18n/ru'
import { ES } from './i18n/es'
import { DE } from './i18n/de'
import { PT } from './i18n/pt'

// ---------------------------------------------------------------------------
// 多语言架构：key 为英文（语义化），各语言字典独立维护。
// 支持：简中(zh) / 繁中(zh-TW) / 英(en) / 日(ja) / 韩(ko) / 法(fr) / 俄(ru) /
//       西(es) / 德(de) / 葡(pt)，共 10 种；加「跟随系统」。
// 跟随系统时按 navigator.language 匹配支持语言，无对应语言回退英语。
// ---------------------------------------------------------------------------

export type LangCode =
  | 'zh' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'fr' | 'ru' | 'es' | 'de' | 'pt'
export type LocalePref = 'system' | LangCode

export interface LocaleEntry {
  value: LocalePref
  endonym: string     // 本地名（原样显示，不翻译）
}

// 语言列表：跟随系统置顶，其余按 ISO 639-1 代码字母升序排列
export const LOCALES: LocaleEntry[] = [
  { value: 'system', endonym: '' },
  { value: 'de', endonym: 'Deutsch' },
  { value: 'en', endonym: 'English' },
  { value: 'es', endonym: 'Español' },
  { value: 'fr', endonym: 'Français' },
  { value: 'ja', endonym: '日本語' },
  { value: 'ko', endonym: '한국어' },
  { value: 'pt', endonym: 'Português' },
  { value: 'ru', endonym: 'Русский' },
  { value: 'zh', endonym: '简体中文' },
  { value: 'zh-TW', endonym: '繁體中文' },
]

const SUPPORTED: LangCode[] = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'ru', 'es', 'de', 'pt']
const ALL_PREFS: LocalePref[] = ['system', ...SUPPORTED]
const LOCALE_KEY = 'app-locale'

const HTML_LANG: Record<LangCode, string> = {
  zh: 'zh-CN', 'zh-TW': 'zh-TW', en: 'en', ja: 'ja', ko: 'ko',
  fr: 'fr', ru: 'ru', es: 'es', de: 'de', pt: 'pt',
}

export function getStoredLocale(): LocalePref {
  const v = localStorage.getItem(LOCALE_KEY)
  return (ALL_PREFS as string[]).includes(v ?? '') ? (v as LocalePref) : 'system'
}

// 跟随系统：按浏览器语言匹配支持语言，无对应语言回退英语
export function resolveLocale(pref: LocalePref): LangCode {
  if (pref !== 'system') return pref
  const nav = (navigator.language || 'en').toLowerCase()
  const base = nav.split('-')[0]
  // 先精确匹配（如 zh-TW），避免被 base(zh) 抢先
  for (const c of SUPPORTED) {
    if (c.toLowerCase() === nav) return c
  }
  // 再按主语言匹配（如 zh）
  for (const c of SUPPORTED) {
    if (c.toLowerCase() === base) return c
  }
  return 'en'
}

export function setLocale(pref: LocalePref) {
  localStorage.setItem(LOCALE_KEY, pref)
  const resolved = resolveLocale(pref)
  currentResolved = resolved
  document.documentElement.lang = HTML_LANG[resolved]
  document.documentElement.setAttribute('data-locale', resolved)
}

export function applyInitialPreferences() {
  setLocale(getStoredLocale())
}

let currentResolved: LangCode = resolveLocale(getStoredLocale())

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `\{${k}\}`))
}

const DICTS: Partial<Record<LangCode, Record<string, string>>> = {
  zh: ZH, 'zh-TW': ZH_TW, en: EN, ja: JA, ko: KO, fr: FR, ru: RU, es: ES, de: DE, pt: PT,
}

// key 为英文；当前语言字典缺失时回退英语，再缺失则原样返回 key
export function translate(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[currentResolved]
  const val = dict?.[key] ?? EN[key]
  return interpolate(val ?? key, vars)
}

interface I18nCtx {
  pref: LocalePref
  resolved: LangCode
  setLocale: (pref: LocalePref) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const LocaleContext = React.createContext<I18nCtx | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPref] = React.useState<LocalePref>(() => getStoredLocale())
  const resolved = resolveLocale(pref)

  React.useEffect(() => {
    currentResolved = resolved
    document.documentElement.lang = HTML_LANG[resolved]
    document.documentElement.setAttribute('data-locale', resolved)
  }, [resolved])

  const change = React.useCallback((p: LocalePref) => {
    setLocale(p)
    setPref(p)
  }, [])

  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars),
    [resolved],
  )

  return (
    <LocaleContext.Provider value={{ pref, resolved, setLocale: change, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useI18n(): I18nCtx {
  const ctx = React.useContext(LocaleContext)
  if (!ctx) throw new Error('useI18n must be used within <LocaleProvider>')
  return ctx
}
