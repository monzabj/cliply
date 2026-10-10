'use client'

import * as React from 'react'
import { dictionaries, en, type DictKey } from './dictionaries'
import type { Language } from '@/lib/clipper/types'

export type ResolvedLanguage = 'en' | 'es'

export type TFunction = (key: DictKey, vars?: Record<string, string | number>) => string

/** 'auto' follows the OS/browser locale; anything else is taken literally. */
export function resolveLanguage(setting: Language): ResolvedLanguage {
  if (setting === 'es' || setting === 'en') return setting
  if (typeof navigator === 'undefined') return 'en'
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}

export function createT(lang: ResolvedLanguage): TFunction {
  const dict = dictionaries[lang] ?? en
  return (key, vars) => interpolate(dict[key] ?? en[key] ?? key, vars)
}

interface I18nValue {
  lang: ResolvedLanguage
  t: TFunction
}

const I18nContext = React.createContext<I18nValue>({ lang: 'en', t: createT('en') })

export function I18nProvider({ language, children }: { language: Language; children: React.ReactNode }) {
  // Resolved after mount so SSR and the first client render agree; 'auto' would
  // otherwise read navigator.language on the client only and mismatch.
  const [lang, setLang] = React.useState<ResolvedLanguage>(() =>
    language === 'auto' ? 'en' : (language as ResolvedLanguage),
  )

  React.useEffect(() => {
    setLang(resolveLanguage(language))
  }, [language])

  const value = React.useMemo<I18nValue>(() => ({ lang, t: createT(lang) }), [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return React.useContext(I18nContext)
}

export function useT(): TFunction {
  return React.useContext(I18nContext).t
}

/** BCP-47 tag for Intl date/number formatting. */
export function localeTag(lang: ResolvedLanguage) {
  return lang === 'es' ? 'es-AR' : 'en-US'
}

export type { DictKey }
