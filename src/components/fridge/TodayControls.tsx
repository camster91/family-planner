'use client'

import * as React from 'react'
import Link from 'next/link'
import { CalendarPlus, ListPlus, ShoppingCart, Utensils, SlidersHorizontal, RefreshCw, Settings, LayoutGrid } from 'lucide-react'
import type { BoardLinks } from '@/app/dashboard/today/today-board-data'
import { canRoleAccessPath } from '@/lib/kid-access'
import { useDisplayLocale } from '@/components/ui/use-display-locale'

const targetClass = 'inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-label-primary bg-[var(--surface-elevated)] border border-[var(--surface-separator)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] active:bg-accent-tint'
const menuClass = 'flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-text)] active:bg-accent-tint'

/** Navigation only: forms and household writes retain their canonical authorization. */
export default function TodayControls({ links, role, onRefresh, online }: {
  links: BoardLinks
  role: string
  onRefresh: () => void
  online: boolean
}) {
  const locale = useDisplayLocale()
  const es = locale.startsWith('es')
  const copy = (en: string, spanish: string) => es ? spanish : en
  const details = React.useRef<HTMLDetailsElement>(null)
  const parent = role === 'parent'
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  return (
    <nav aria-label={copy('Today quick actions', 'Acciones rápidas de hoy')} className="relative mb-4 flex flex-wrap items-center gap-2 md:mb-5">
      {parent && links.calendar && <Link href="/dashboard/calendar/create" className={targetClass}><CalendarPlus size={18} aria-hidden="true" />{copy('Add event', 'Añadir evento')}</Link>}
      {parent && links.chores && <Link href="/dashboard/chores/create" className={targetClass}><ListPlus size={18} aria-hidden="true" />{copy('Add chore', 'Añadir tarea')}</Link>}
      {links.lists && <Link href="/dashboard/lists/groceries" className={targetClass}><ShoppingCart size={18} aria-hidden="true" />{copy('Groceries', 'Alimentos')}</Link>}
      {links.meals && <Link href={links.meals} className={targetClass}><Utensils size={18} aria-hidden="true" />{copy('Plan meals', 'Planear comidas')}</Link>}
      {links.lists && <Link href="/dashboard/lists" className={targetClass}><LayoutGrid size={18} aria-hidden="true" />{copy('All lists', 'Todas las listas')}</Link>}
      <details ref={details} onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current?.open) {
          details.current.open = false
          details.current.querySelector('summary')?.focus()
          event.stopPropagation()
        }
      }}>
        <summary className={`${targetClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><SlidersHorizontal size={18} aria-hidden="true" />{copy('Today controls', 'Controles de hoy')}</summary>
        <div className="absolute right-0 top-full z-20 mt-2 w-56 max-w-[calc(100vw-3rem)] rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-2 shadow-xl">
          <button type="button" disabled={!online} className={`${menuClass} disabled:opacity-50`} onClick={() => { if (details.current) details.current.open = false; details.current?.querySelector('summary')?.focus(); onRefresh() }}><RefreshCw size={18} aria-hidden="true" />{copy('Refresh now', 'Actualizar ahora')}</button>
          {!online && <p className="px-3 text-xs text-label-secondary">{copy('Reconnect to refresh.', 'Conéctate para actualizar.')}</p>}
          {parent && links.features && <Link href={links.features} className={menuClass}><LayoutGrid size={18} aria-hidden="true" />{copy('Household features', 'Funciones del hogar')}</Link>}
          {canRoleAccessPath(role, '/dashboard/settings') && <Link href="/dashboard/settings" className={menuClass}><Settings size={18} aria-hidden="true" />{copy('My settings', 'Mis ajustes')}</Link>}
        </div>
      </details>
    </nav>
  )
}
