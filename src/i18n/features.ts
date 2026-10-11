/** Features-settings copy. Feature titles and descriptions come from the canonical metadata. */
import { useTranslation } from '@/i18n'

export const featuresEnglish = {
  greeting: 'Family settings',
  title: 'Features',
  subtitle:
    'Turn features on or off. Disabled features are hidden from the dashboard for everyone.',
  searchLabel: 'Search features',
  searchPlaceholder: 'Search features',
  clearSearch: 'Clear feature search',
  noMatches: 'No features match your search.',
  clearFilters: 'Clear search',
  groupNavigation: 'Feature groups',
  openAll: 'Open all groups',
  closeAll: 'Close all groups',
  showGroup: 'Show {group}',
  hideGroup: 'Hide {group}',
  featuresCount: '{count} features',
  enabledSummary: '{enabled} of {total} on',
  availableSummary: '{count} available',
  blockedSummary: '{count} blocked',
  on: 'On',
  off: 'Off',
  blocked: 'Blocked',
  locked: 'Locked',
  updating: 'Updating…',
  needs: 'Needs {dependency}. Turn that on first.',
  enable: 'Enable {title}',
  disable: 'Disable {title}',
  enabledToast: '{title} enabled',
  disabledToast: '{title} disabled',
  updateFailed: 'Could not update {title}',
  coreTitle: 'Core',
  coreSubtitle: 'Always on. These keep the app working.',
  planningTitle: 'Planning',
  planningSubtitle:
    'Turn on what helps your family. Turn off what you do not use.',
  familyTitle: 'Family life',
  familySubtitle: 'Off by default. Turn on to add to your dashboard.',
} as const

export type FeaturesMessage = keyof typeof featuresEnglish
export type FeaturesMessages = Record<FeaturesMessage, string>

export const featuresSpanish: FeaturesMessages = {
  greeting: 'Configuración familiar',
  title: 'Funciones',
  subtitle:
    'Activa o desactiva funciones. Las funciones desactivadas se ocultan del panel para todos.',
  searchLabel: 'Buscar funciones',
  searchPlaceholder: 'Buscar funciones',
  clearSearch: 'Borrar búsqueda de funciones',
  noMatches: 'Ninguna función coincide con tu búsqueda.',
  clearFilters: 'Borrar búsqueda',
  groupNavigation: 'Grupos de funciones',
  openAll: 'Abrir todos los grupos',
  closeAll: 'Cerrar todos los grupos',
  showGroup: 'Mostrar {group}',
  hideGroup: 'Ocultar {group}',
  featuresCount: '{count} funciones',
  enabledSummary: '{enabled} de {total} activadas',
  availableSummary: '{count} disponibles',
  blockedSummary: '{count} bloqueadas',
  on: 'Activada',
  off: 'Desactivada',
  blocked: 'Bloqueada',
  locked: 'Fija',
  updating: 'Actualizando…',
  needs: 'Necesita {dependency}. Actívala primero.',
  enable: 'Activar {title}',
  disable: 'Desactivar {title}',
  enabledToast: '{title} activada',
  disabledToast: '{title} desactivada',
  updateFailed: 'No se pudo actualizar {title}',
  coreTitle: 'Esenciales',
  coreSubtitle: 'Siempre activadas. Mantienen la aplicación funcionando.',
  planningTitle: 'Planificación',
  planningSubtitle:
    'Activa lo que ayuda a tu familia. Desactiva lo que no uses.',
  familyTitle: 'Vida familiar',
  familySubtitle:
    'Desactivadas al principio. Actívalas para añadirlas al panel.',
}

export const featuresMessages = {
  en: featuresEnglish,
  es: featuresSpanish,
}

export function useFeaturesText() {
  const { t: translate } = useTranslation()
  return (key: FeaturesMessage, params?: Record<string, string | number>) =>
    translate(key, params, featuresMessages)
}
