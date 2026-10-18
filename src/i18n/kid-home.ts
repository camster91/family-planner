import type { Locale } from './types'
import { useTranslation } from './index'

/**
 * Presentation copy for the child and teen home. Household-provided names,
 * chore text, notes and server-owned error details stay outside this dictionary.
 */
export const kidHomeEnglish = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'yesterday',
  wasDue: 'Was due {date}',
  markDoneError: "Couldn't mark it done",
  tryAgain: 'Please try again.',
  connectionError: 'Check your connection and try again.',
  done: 'Done',
  doneToast: '“{title}” done',
  parentWillCheck: 'A parent will check it.',
  undoError: "Couldn't undo",
  haveAnotherGo: 'Have another go',
  didIt: 'You did it!',
  greeting: 'Hi, {name}!',
  greetingFallback: 'there',
  limitedWork:
    'Showing a limited set of your chores. A parent can help you find any others.',
  todayMissions: "Today's Missions",
  stillToDo: 'Still to do',
  routineCatchup: 'Routine catch-up',
  catchupDescription: 'Earlier steps to finish when you can.',
  showLess: 'Show less',
  showMore: 'Show more ({count})',
  todayChores: "Today's chores",
  close: 'Close',
  allDoneForToday: 'All done for today!',
  allDoneToday: 'All done for today.',
  enjoyDay: 'Enjoy your day, superstar!',
  nothingNewToday: 'Nothing new today!',
  finishAbove: 'Finish the ones above when you can.',
  level: 'Level {level}',
  pointsToGo: '{count} points to go!',
  more: '+{count} more',
  comingUp: 'Coming up',
  allDone: 'All done',
  progressDone: '{done} of {total} done',
  progressLabel: '{name} progress',
  stepOf: 'step {step} of {total}',
  next: 'Next',
  nextStep: 'next step',
  doneWaiting: 'done, waiting for a parent to check',
  doneChecked: 'done, checked by a parent',
  waitingForParent: 'Waiting for a parent',
  checkedByParent: 'Checked by a parent',
} as const

export const kidHomeSpanish: Record<keyof typeof kidHomeEnglish, string> = {
  today: 'Hoy',
  tomorrow: 'Mañana',
  yesterday: 'ayer',
  wasDue: 'Era para {date}',
  markDoneError: 'No se pudo marcar como hecha',
  tryAgain: 'Inténtalo de nuevo.',
  connectionError: 'Revisa tu conexión e inténtalo de nuevo.',
  done: 'Hecha',
  doneToast: '«{title}» hecha',
  parentWillCheck: 'Un padre o madre la revisará.',
  undoError: 'No se pudo deshacer',
  haveAnotherGo: 'Inténtalo de nuevo',
  didIt: '¡Lo lograste!',
  greeting: '¡Hola, {name}!',
  greetingFallback: 'ahí',
  limitedWork:
    'Se muestra una parte de tus tareas. Un padre o madre puede ayudarte a encontrar las demás.',
  todayMissions: 'Misiones de hoy',
  stillToDo: 'Pendientes',
  routineCatchup: 'Rutinas pendientes',
  catchupDescription: 'Termina estos pasos anteriores cuando puedas.',
  showLess: 'Mostrar menos',
  showMore: 'Mostrar más ({count})',
  todayChores: 'Tareas de hoy',
  close: 'Cerrar',
  allDoneForToday: '¡Todo listo por hoy!',
  allDoneToday: 'Todo listo por hoy.',
  enjoyDay: '¡Disfruta tu día, campeón!',
  nothingNewToday: '¡Nada nuevo hoy!',
  finishAbove: 'Termina las tareas de arriba cuando puedas.',
  level: 'Nivel {level}',
  pointsToGo: '¡Te faltan {count} puntos!',
  more: '+{count} más',
  comingUp: 'Próximamente',
  allDone: 'Todo listo',
  progressDone: '{done} de {total} hechas',
  progressLabel: 'Progreso de {name}',
  stepOf: 'paso {step} de {total}',
  next: 'Siguiente',
  nextStep: 'siguiente paso',
  doneWaiting: 'hecha, esperando que un padre o madre la revise',
  doneChecked: 'hecha, revisada por un padre o madre',
  waitingForParent: 'Esperando que un padre o madre la revise',
  checkedByParent: 'Revisada por un padre o madre',
}

export const kidHomeMessages: Record<
  Locale,
  Record<keyof typeof kidHomeEnglish, string>
> = {
  en: kidHomeEnglish,
  es: kidHomeSpanish,
}

export type KidHomeMessage = keyof typeof kidHomeEnglish

export function useKidHomeText() {
  const { t: translate } = useTranslation()
  return (key: KidHomeMessage, params?: Record<string, string | number>) =>
    translate(key, params, kidHomeMessages)
}
