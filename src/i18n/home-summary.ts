import { useTranslation } from '@/i18n'
import {
  defaultHomeSummaryMessages,
  type HomeSummaryPresentationMessages,
} from '@/lib/home-summary'

export const homeSummaryEnglish: HomeSummaryPresentationMessages = defaultHomeSummaryMessages

export const homeSummarySpanish: HomeSummaryPresentationMessages = {
  sectionLabel: 'Tus tareas',
  done: 'Hecha',
  doneWaiting: 'Hecha · esperando que un padre la revise',
  checkedByParent: 'Revisada por un padre',
  dueToday: 'Para hoy',
  toCheck: (count) => `${count} ${count === 1 ? 'tarea por revisar' : 'tareas por revisar'}`,
  allChores: 'Todas las tareas',
  everyChoreDoneToday: 'Todas las tareas están hechas hoy',
  noChoresToday: 'No hay tareas para hoy',
  assigneeFallback: 'alguien',
  choresLeftToday: (count, people) =>
    `${count} ${count === 1 ? 'tarea pendiente hoy' : 'tareas pendientes hoy'} · ${people}`,
  choresLeft: (count) => `Te ${count === 1 ? 'queda' : 'quedan'} ${count} ${count === 1 ? 'tarea' : 'tareas'}`,
  doneForToday: 'Ya terminaste por hoy',
  nothingOnListToday: 'Hoy no tienes tareas',
  undoTitle: (title) => `«${title}» hecha`,
  undoMessage: 'Un padre la revisará.',
  completeErrorTitle: (title) => `No se pudo marcar «${title}» como hecha`,
  undoErrorTitle: (title) => `No se pudo deshacer «${title}»`,
}

export const homeSummaryMessages = {
  en: homeSummaryEnglish,
  es: homeSummarySpanish,
} as const

export function useHomeSummaryText(): HomeSummaryPresentationMessages {
  const { locale } = useTranslation()
  return homeSummaryMessages[locale]
}
