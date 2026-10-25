import { useTranslation } from '@/i18n'
const en = {
  title: 'Imported data', back: 'Back to Budget', intro: 'Browse preserved source records. Amounts and dates still need review before they can be used in your budget.',
  type: 'Record type', all: 'All record types', loading: 'Loading preserved records…', failed: 'Could not load this page. Previous records, if shown, may be out of date.', retry: 'Try again', refresh: 'Refresh',
  unavailable: 'This review is unavailable or your account access changed. Return to Budget to continue.', empty: 'No preserved records in this view.', next: 'Older records', newest: 'Newest records',
  details: 'Source details', close: 'Close', sourceApp: 'Source app', sourceModel: 'Source record type', sourceId: 'Source record ID', preserved: 'Preserved on',
  shortened: 'Long source labels are shortened here. Your private data export keeps the full originals.', exportHelp: 'Open data settings',
  accounts: 'Accounts', bills: 'Bills', billPayments: 'Bill payments', budgets: 'Budgets', goals: 'Goals', goalContributions: 'Goal contributions', incomes: 'Income plans', screenshotReceipts: 'Receipt references', spendingPatterns: 'Spending patterns', dailyPeriods: 'Daily periods', noSpendEntries: 'No-spend records', other: 'Other source records',
} as const
type Key = keyof typeof en
const es: Record<Key, string> = {
  title: 'Datos importados', back: 'Volver al presupuesto', intro: 'Consulta los registros de origen conservados. Los importes y las fechas necesitan revisión antes de usarse en tu presupuesto.',
  type: 'Tipo de registro', all: 'Todos los tipos', loading: 'Cargando registros conservados…', failed: 'No se pudo cargar esta página. Los registros anteriores, si se muestran, pueden estar desactualizados.', retry: 'Intentar de nuevo', refresh: 'Actualizar',
  unavailable: 'Esta revisión no está disponible o cambió el acceso de tu cuenta. Vuelve al presupuesto para continuar.', empty: 'No hay registros conservados en esta vista.', next: 'Registros anteriores', newest: 'Registros más recientes',
  details: 'Detalles del origen', close: 'Cerrar', sourceApp: 'App de origen', sourceModel: 'Tipo de registro de origen', sourceId: 'ID del registro de origen', preserved: 'Conservado el',
  shortened: 'Las etiquetas largas se abrevian aquí. Tu exportación privada conserva los originales completos.', exportHelp: 'Abrir ajustes de datos',
  accounts: 'Cuentas', bills: 'Facturas', billPayments: 'Pagos de facturas', budgets: 'Presupuestos', goals: 'Metas', goalContributions: 'Aportaciones a metas', incomes: 'Planes de ingresos', screenshotReceipts: 'Referencias de recibos', spendingPatterns: 'Patrones de gasto', dailyPeriods: 'Períodos diarios', noSpendEntries: 'Registros sin gastos', other: 'Otros registros de origen',
}
export function useFinanceArchiveText() {
  const { t } = useTranslation()
  return (key: Key) => t(key, undefined, { en, es })
}
