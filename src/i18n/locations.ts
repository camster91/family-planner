/** Locations-owned confirmation and recovery copy. Household labels stay verbatim. */
import { useTranslation } from '@/i18n'

export const locationsEnglish = {
  loadErrorTitle: 'Couldn\'t load locations',
  loadErrorDescription: 'We couldn\'t load your family\'s saved places.',
  retry: 'Try again',
  refreshing: 'Refreshing…',
  removeTitle: 'Remove “{label}”?',
  removeDescription:
    'This permanently removes “{label}” from the family’s saved places.',
  removeFailed: 'The location could not be removed. Try again.',
  removeNetworkError:
    'The location could not be removed. Check your connection and try again.',
  removeClose: 'Close location removal confirmation',
  removeButton: 'Remove {label}',
  removing: 'Removing…',
} as const

export type LocationsMessage = keyof typeof locationsEnglish

export const locationsSpanish: Record<LocationsMessage, string> = {
  loadErrorTitle: 'No se pudieron cargar los lugares',
  loadErrorDescription: 'No se pudieron cargar los lugares guardados de tu familia.',
  retry: 'Intentar de nuevo',
  refreshing: 'Actualizando…',
  removeTitle: '¿Quitar «{label}»?',
  removeDescription:
    'Esto quitará permanentemente «{label}» de los lugares guardados de la familia.',
  removeFailed: 'No se pudo quitar el lugar. Inténtalo de nuevo.',
  removeNetworkError:
    'No se pudo quitar el lugar. Revisa tu conexión e inténtalo de nuevo.',
  removeClose: 'Cerrar confirmación para quitar el lugar',
  removeButton: 'Quitar {label}',
  removing: 'Quitando…',
}

export const locationsMessages = {
  en: locationsEnglish,
  es: locationsSpanish,
}

export function useLocationsText() {
  const { t: translate } = useTranslation()
  return (key: LocationsMessage, params?: Record<string, string | number>) =>
    translate(key, params, locationsMessages)
}
