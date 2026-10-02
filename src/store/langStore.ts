import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import en from '../translations/en.json'
import ta from '../translations/ta.json'

type Lang = 'en' | 'ta'

type DictValue = string | { [key: string]: DictValue }
type Dict = Record<string, DictValue>

const FALLBACK_LABELS: Record<string, string> = {
  'CAT.EXPLORE_TITLE': 'Shop by Category',
  'CAT.EXPLORE_SUB': 'Traditional herbal categories hand-curated for you',
  'cat.explore_title': 'Shop by Category',
  'cat.explore_sub': 'Traditional herbal categories hand-curated for you',
  'common.shopNow': 'Shop Now',
}

const LEGACY_KEY_ALIASES: Record<string, string> = {
  'CAT.EXPLORE_TITLE': 'cat.title',
  'CAT.EXPLORE_SUB': 'cat.sub',
  'cat.explore_title': 'cat.title',
  'cat.explore_sub': 'cat.sub',
}

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string) => string
}

const dict: Record<Lang, Dict> = {
  en,
  ta,
}

const getTranslation = (dictionary: Dict, key: string): string | undefined => {
  const aliasKey = LEGACY_KEY_ALIASES[key] || LEGACY_KEY_ALIASES[key.toLowerCase()] || key
  const direct = dictionary[aliasKey]
  if (typeof direct === 'string') return direct

  let current: DictValue | undefined = dictionary
  for (const part of aliasKey.split('.')) {
    if (!current || typeof current === 'string') return undefined
    current = current[part]
  }

  return typeof current === 'string' ? current : undefined
}

const titleCase = (value: string) => value
  .split(' ')
  .filter(Boolean)
  .map((word) => word[0] ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
  .join(' ')

const humanizeKey = (key: string): string => {
  const fallbackKey = LEGACY_KEY_ALIASES[key] || LEGACY_KEY_ALIASES[key.toLowerCase()] || key
  if (FALLBACK_LABELS[fallbackKey]) {
    return FALLBACK_LABELS[fallbackKey]
  }

  const last = fallbackKey.split('.').pop() || fallbackKey
  const normalized = last.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  return titleCase(normalized)
}

export const useLangStore = create<LangState>()(
  persist(
    (set, get) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
      t: (key) => getTranslation(dict[get().lang], key) || getTranslation(dict.en, key) || humanizeKey(key),
    }),
    { name: 'mahalashmi-stores-lang' },
  ),
)
