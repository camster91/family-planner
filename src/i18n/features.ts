/** Features-settings copy. Feature titles and descriptions come from the canonical metadata. */
import { useTranslation } from '@/i18n'

export const featuresEnglish = {
  greeting: 'Family settings',
  title: 'Features',
  subtitle:
    'Pick what your family uses. Features you turn off are hidden for everyone.',
  // Setups (presets), UI review item 11.
  presetsTitle: 'Pick a setup',
  presetsHint: 'Start with a setup, then change any switch below.',
  presetEssentials: 'Essentials',
  presetEssentialsDescription: 'Calendar, chores, lists and meals. A calm start.',
  presetSchool: 'Busy school year',
  presetSchoolDescription:
    'Essentials plus pickups, places, sitter notes, pinned notes and sick days.',
  presetEverything: 'Everything',
  presetEverythingDescription: 'Every feature on. Turn off what you do not use.',
  presetCustom: 'Custom',
  presetCustomDescription: 'Choose each feature yourself below.',
  presetInUse: 'In use now',
  presetPreviewTitle: 'Use {preset}?',
  presetTurnsOn: 'Turns on',
  presetTurnsOff: 'Turns off',
  presetNoChanges: 'Your features already match this setup.',
  presetApply: 'Use this setup',
  presetApplying: 'Changing…',
  presetCancel: 'Cancel',
  presetApplied: '{preset} is set up.',
  presetUndo: 'Undo',
  presetUndone: 'Your features are back how they were.',
  presetFailed: 'Could not change your features. Nothing was changed.',
  presetUndoFailed: 'Could not undo. Your features were not changed.',
  // The list
  on: 'On',
  off: 'Off',
  updating: 'Updating…',
  needs: 'Needs {dependency}. Turn that on first.',
  enable: 'Enable {title}',
  disable: 'Disable {title}',
  enabledToast: '{title} enabled',
  disabledToast: '{title} disabled',
  updateFailed: 'Could not update {title}',
  homeTitle: 'Home and planning',
  schoolTitle: 'School days and care',
  kidsTitle: 'Kids, points and money',
  alwaysOnTitle: 'Always on',
  alwaysOnSubtitle: 'These keep the app working, so they cannot be turned off.',
  // Explore (family/more) group labels reuse these.
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
    'Elige lo que usa tu familia. Las funciones que desactives se ocultan para todos.',
  presetsTitle: 'Elige una configuración',
  presetsHint: 'Empieza con una configuración y luego cambia cualquier interruptor.',
  presetEssentials: 'Lo esencial',
  presetEssentialsDescription:
    'Calendario, tareas, listas y comidas. Un comienzo tranquilo.',
  presetSchool: 'Año escolar ocupado',
  presetSchoolDescription:
    'Lo esencial más recogidas, lugares, notas para el cuidador, notas fijadas y días de enfermedad.',
  presetEverything: 'Todo',
  presetEverythingDescription:
    'Todas las funciones activadas. Desactiva lo que no uses.',
  presetCustom: 'Personalizada',
  presetCustomDescription: 'Elige cada función tú mismo abajo.',
  presetInUse: 'En uso ahora',
  presetPreviewTitle: '¿Usar «{preset}»?',
  presetTurnsOn: 'Se activan',
  presetTurnsOff: 'Se desactivan',
  presetNoChanges: 'Tus funciones ya coinciden con esta configuración.',
  presetApply: 'Usar esta configuración',
  presetApplying: 'Cambiando…',
  presetCancel: 'Cancelar',
  presetApplied: '«{preset}» está lista.',
  presetUndo: 'Deshacer',
  presetUndone: 'Tus funciones volvieron a como estaban.',
  presetFailed: 'No se pudieron cambiar tus funciones. No se cambió nada.',
  presetUndoFailed: 'No se pudo deshacer. Tus funciones no cambiaron.',
  on: 'Activada',
  off: 'Desactivada',
  updating: 'Actualizando…',
  needs: 'Necesita {dependency}. Actívala primero.',
  enable: 'Activar {title}',
  disable: 'Desactivar {title}',
  enabledToast: '{title} activada',
  disabledToast: '{title} desactivada',
  updateFailed: 'No se pudo actualizar {title}',
  homeTitle: 'Casa y planificación',
  schoolTitle: 'Días de escuela y cuidados',
  kidsTitle: 'Niños, puntos y dinero',
  alwaysOnTitle: 'Siempre activadas',
  alwaysOnSubtitle:
    'Mantienen la aplicación funcionando, así que no se pueden desactivar.',
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
