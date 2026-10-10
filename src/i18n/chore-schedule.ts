/** Monthly policy shared by ordinary chores and routine steps. */
export const choreScheduleMessages = {
  en: {
    monthlyHint: 'Repeats on the original day of the month. In shorter months, uses the last day, then returns to the original day. Existing scheduled dates stay as they are.',
  },
  es: {
    monthlyHint: 'Se repite en el día original de cada mes. En los meses más cortos, usa el último día y luego vuelve al día original. Las fechas ya programadas se mantienen.',
  },
} as const
