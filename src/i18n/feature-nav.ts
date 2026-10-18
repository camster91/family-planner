import { useTranslation } from '@/i18n'
import type { FeatureKey } from '@/lib/features'
import type { Locale } from './types'

/**
 * The kid menu is rendered by the shared dashboard shell. Keep only the
 * labels it can expose in that initial graph; the full title/description
 * catalog belongs to feature pages and their lazy surfaces.
 */
type FeatureNavKey =
  | 'wishlist'
  | 'allowance'
  | 'handoff'
  | 'sick-days'
  | 'notes'
  | 'anniversaries'
  | 'pickups'

const english: Record<FeatureNavKey, string> = {
  wishlist: 'Wishlist',
  allowance: 'Allowance & IOUs',
  handoff: 'Babysitter handoff',
  'sick-days': 'Sick days & meds',
  notes: 'Pinned notes',
  anniversaries: 'Birthdays & anniversaries',
  pickups: 'Pickups & dropoffs',
}

const spanish: Record<FeatureNavKey, string> = {
  wishlist: 'Lista de deseos',
  allowance: 'Mesada y deudas',
  handoff: 'Entrega al cuidador',
  'sick-days': 'Días de enfermedad y medicinas',
  notes: 'Notas fijadas',
  anniversaries: 'Cumpleaños y aniversarios',
  pickups: 'Recogidas y entregas',
}

export type FeatureNavTitleResolver = (key: FeatureKey) => string

export function getFeatureNavTitle(locale: Locale, key: FeatureKey): string {
  if (!(key in english)) return key
  const navKey = key as FeatureNavKey
  return (locale === 'es' ? spanish : english)[navKey]
}

export function useFeatureNavTitle(): FeatureNavTitleResolver {
  const { locale } = useTranslation()
  return (key) => getFeatureNavTitle(locale, key)
}
