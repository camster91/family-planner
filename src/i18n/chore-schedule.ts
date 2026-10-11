/** Monthly policy shared by ordinary chores and routine steps. */
export const choreScheduleMessages = {
  en: {
    monthlyHint: 'Repeats on the original day of the month. In shorter months, uses the last day, then returns to the original day. Existing scheduled dates stay as they are.',
    weeklyLegend: 'Repeat on',
    weeklyHint: 'Choose one or more days each week.',
    weeklyDays: 'Every {days}',
    weekdayNames: {
      0: 'Sunday',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
    },
  },
  es: {
    monthlyHint: 'Se repite en el día original de cada mes. En los meses más cortos, usa el último día y luego vuelve al día original. Las fechas ya programadas se mantienen.',
    weeklyLegend: 'Repetir los',
    weeklyHint: 'Elige uno o más días de cada semana.',
    weeklyDays: 'Cada {days}',
    weekdayNames: {
      0: 'Domingo',
      1: 'Lunes',
      2: 'Martes',
      3: 'Miércoles',
      4: 'Jueves',
      5: 'Viernes',
      6: 'Sábado',
    },
  },
} as const
