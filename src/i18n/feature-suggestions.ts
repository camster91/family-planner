import { useTranslation } from '@/i18n'

export const featureSuggestionsEnglish = {
  heading: 'Turn on more',
  description: 'Your household starts simple. Add a section when it would help.',
  hideSuggestions: 'Not now, hide suggestions',
  hideButton: 'Not now',
  sectionsLabel: 'Sections you can turn on',
  onForHousehold: 'On for your household',
  open: 'Open',
  turnOn: 'Turn on',
  seeAll: 'See all features',
  turnOnFailed: 'Could not turn on {title}',
  turnedOn: '{title} turned on',
  turnOffFailed: 'Could not turn off {title}',
  updateFailedTitle: 'Feature update failed',
  hidden: 'Suggestions hidden',
  hiddenMessage: 'You can turn sections on any time in Features.',
} as const

export type FeatureSuggestionsMessage = keyof typeof featureSuggestionsEnglish
export type FeatureSuggestionsMessages = Record<FeatureSuggestionsMessage, string>

export const featureSuggestionsSpanish: FeatureSuggestionsMessages = {
  heading: 'Activa más funciones',
  description: 'Tu hogar empieza con lo esencial. Añade una sección cuando te ayude.',
  hideSuggestions: 'Ahora no, ocultar sugerencias',
  hideButton: 'Ahora no',
  sectionsLabel: 'Secciones que puedes activar',
  onForHousehold: 'Activada para tu hogar',
  open: 'Abrir',
  turnOn: 'Activar',
  seeAll: 'Ver todas las funciones',
  turnOnFailed: 'No se pudo activar {title}',
  turnedOn: '{title} activada',
  turnOffFailed: 'No se pudo desactivar {title}',
  updateFailedTitle: 'No se pudo actualizar la función',
  hidden: 'Sugerencias ocultas',
  hiddenMessage: 'Puedes activar secciones cuando quieras en Funciones.',
}

export const featureSuggestionsMessages = {
  en: featureSuggestionsEnglish,
  es: featureSuggestionsSpanish,
}

export function useFeatureSuggestionsText() {
  const { t: translate } = useTranslation()
  return (
    key: FeatureSuggestionsMessage,
    params?: Record<string, string | number>,
  ) => translate(key, params, featureSuggestionsMessages)
}
