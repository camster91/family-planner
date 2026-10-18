import { useTranslation } from '@/i18n'

const analyticsEnglish = {
  title: 'Progress',
  subtitle: 'A calm view of what is moving this week',
  weeklyProgress: 'Weekly progress',
  weeklyProgressDescription: 'Your household completed {percent}% of chores due this week.',
  weeklyProgressDescriptionEmpty: 'Start with one small win this week.',
  weeklyTrend: 'This week at a glance',
  weeklyTrendDescription: 'Completed chores over the last seven days.',
  completions: '{count} completed',
  familyPoints: 'Family points',
  bestStreak: 'Best streak',
  daysShort: '{count}d',
  dayStreak: '{count} day streak',
  progressByPerson: 'Progress by person',
  progressByPersonDescription: 'Everyone can see the work that helps the household move forward.',
  level: 'Level {level}',
  points: '{count} points',
  choresDone: '{completed} of {total} chores done',
  noProgress: 'No progress yet',
  noProgressDescription: 'When a chore is completed, it will appear here.',
  loading: 'Loading progress…',
  loadError: 'Could not load progress.',
  retry: 'Try again',
  noTrend: 'No chores completed in this window.',
  trendDay: 'Completed {count} chores on {day}',
} as const

const analyticsSpanish: Record<keyof typeof analyticsEnglish, string> = {
  title: 'Progreso',
  subtitle: 'Una vista tranquila de lo que avanza esta semana',
  weeklyProgress: 'Progreso semanal',
  weeklyProgressDescription: 'Tu hogar completó el {percent}% de las tareas de esta semana.',
  weeklyProgressDescriptionEmpty: 'Comienza con un pequeño logro esta semana.',
  weeklyTrend: 'Esta semana de un vistazo',
  weeklyTrendDescription: 'Tareas completadas durante los últimos siete días.',
  completions: '{count} completadas',
  familyPoints: 'Puntos de la familia',
  bestStreak: 'Mejor racha',
  daysShort: '{count} d',
  dayStreak: '{count} días de racha',
  progressByPerson: 'Progreso por persona',
  progressByPersonDescription: 'Todos pueden ver el trabajo que ayuda a avanzar al hogar.',
  level: 'Nivel {level}',
  points: '{count} puntos',
  choresDone: '{completed} de {total} tareas hechas',
  noProgress: 'Aún no hay progreso',
  noProgressDescription: 'Cuando se complete una tarea, aparecerá aquí.',
  loading: 'Cargando progreso…',
  loadError: 'No se pudo cargar el progreso.',
  retry: 'Intentar de nuevo',
  noTrend: 'No hay tareas completadas en este período.',
  trendDay: '{count} tareas completadas el {day}',
}

const analyticsMessages = { en: analyticsEnglish, es: analyticsSpanish }

export type AnalyticsMessage = keyof typeof analyticsEnglish

export function useAnalyticsText() {
  const { t: translate } = useTranslation()
  return (key: AnalyticsMessage, params?: Record<string, string | number>) =>
    translate(key, params, analyticsMessages)
}
