'use client'

import * as React from 'react'
import { Plus, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles, Undo2, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ListRow, InsetList } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { CaptureBox } from '@/components/capture/CaptureBox'
import { cn } from '@/lib/utils'
import { isInLocalMonth, isInUtcMonth, shiftMonth, toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { useLocalNow } from '@/components/ui/use-hydrated'
import { IMPORT_UNDO_WINDOW_MS, type ImportCommitResult } from '@/lib/event-import-client'
import { ImportEventsDialog } from './ImportEventsDialog'
import { SyncNotice, UpdatedLine, useNow } from '@/components/fridge/sync-status'
import { useOnline } from '@/components/fridge/use-board-sync'

interface EventData {
  id: string
  title: string
  description?: string | null
  start_time: string
  end_time: string
  location?: string | null
  event_type: string
  creator?: { name: string } | null
  // Set for events imported from a subscribed calendar (#232); those are read-only.
  source?: { subscription_id: string; name: string; color: string | null } | null
}

interface CalendarPageClientProps {
  events: EventData[]
  currentMonth: number
  currentYear: number
  /**
   * Show "Import from text or photo" (#270). True only when the deployment has
   * the event import provider configured and the viewer may import.
   */
  importEnabled?: boolean
  /**
   * False when the URL named no month and the server picked its own (UTC)
   * month: the page then moves to the viewer's local month if that differs.
   */
  monthFromUrl?: boolean
}

/** `/dashboard/calendar?year=…&month=…` for a 1-based month. */
export function calendarMonthHref(year: number, month: number): string {
  return `/dashboard/calendar?year=${year}&month=${month}`
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** Previous/next month links (44px targets), each naming the month it opens. */
function MonthNav({ year, month }: { year: number; month: number }) {
  const prev = shiftMonth(year, month, -1)
  const next = shiftMonth(year, month, 1)
  const linkClass =
    'inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-full px-3 text-subhead font-medium text-[var(--accent-text)] active:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]'
  return (
    <nav aria-label="Change month" className="flex items-center justify-between gap-2">
      <Link
        href={calendarMonthHref(prev.year, prev.month)}
        className={linkClass}
        aria-label={`Previous month, ${monthLabel(prev.year, prev.month)}`}
        data-testid="calendar-prev-month"
      >
        <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        <span>Previous</span>
      </Link>
      <Link
        href={calendarMonthHref(next.year, next.month)}
        className={linkClass}
        aria-label={`Next month, ${monthLabel(next.year, next.month)}`}
        data-testid="calendar-next-month"
      >
        <span>Next</span>
        <ChevronRight className="w-5 h-5" aria-hidden="true" />
      </Link>
    </nav>
  )
}

// Times, day keys and day labels depend on the viewer's zone, which the server
// (UTC) does not know (O-31). `now` is null before hydration: days are then
// grouped and labelled by UTC date, with no "Today"/"Tomorrow" and no times, so
// the server HTML and the first client render match. After hydration they
// switch to the viewer's local day and time.

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }

function formatDayLabel(dateStr: string, now: Date | null): string {
  const d = new Date(dateStr)
  if (!now) return d.toLocaleDateString('en-US', { ...DAY_LABEL, timeZone: 'UTC' })
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', DAY_LABEL)
}

/** `YYYY-MM-DD` of the event's day: local once hydrated, UTC before. Sorts as text. */
function getDateKey(dateStr: string, local: boolean): string {
  return local ? toDateOnlyLocal(new Date(dateStr)) : toDateOnlyUTC(new Date(dateStr))
}

function groupEventsByDay(events: EventData[], local: boolean): Map<string, EventData[]> {
  const map = new Map<string, EventData[]>()
  for (const event of events) {
    const key = getDateKey(event.start_time, local)
    const group = map.get(key) || []
    group.push(event)
    map.set(key, group)
  }
  return map
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  school: 'school',
  sports: 'sports',
  appointment: 'appointment',
  family: 'family',
  work: 'work',
  other: 'other',
}

const CALENDAR_ICON_COLORS: Record<string, string> = {
  school: 'calendar',
  sports: 'calendar',
  appointment: 'calendar',
  family: 'calendar',
  work: 'calendar',
  other: 'calendar',
}

export function SourceBadge({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full bg-[var(--surface-fill)] px-2 py-0.5 text-caption-1 text-label-secondary"
      title={`Read-only. Imported from ${name}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? 'var(--label-tertiary, #8e8e93)' }}
      />
      <span className="truncate">From {name}</span>
    </span>
  )
}

/** Re-request the page when the tab comes back after this long, or when the connection returns. */
const CALENDAR_REFRESH_AFTER_MS = 5 * 60 * 1000

/**
 * "Updated just now / 3 min ago" and the offline notice for the calendar
 * (#271), on the viewer's own clock. The calendar does not poll: it
 * re-requests its server component when the connection returns or the tab
 * becomes visible with data older than CALENDAR_REFRESH_AFTER_MS.
 */
function CalendarSyncLine({ events }: { events: unknown }) {
  const router = useRouter()
  const online = useOnline()
  const now = useNow(15 * 1000)
  const [loadedAt, setLoadedAt] = React.useState<number | null>(null)
  const loadedRef = React.useRef(0)

  React.useEffect(() => {
    const t = Date.now()
    loadedRef.current = t
    setLoadedAt(t)
  }, [events])

  React.useEffect(() => {
    const refresh = () => {
      if (navigator.onLine) router.refresh()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedRef.current >= CALENDAR_REFRESH_AFTER_MS) refresh()
    }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router])

  if (now === null) return null
  return (
    <div className="px-4 mb-4 space-y-3">
      <UpdatedLine
        lastSyncAt={loadedAt}
        now={now}
        testId="calendar-updated"
        className="text-footnote text-label-secondary"
      />
      <SyncNotice lastSyncAt={loadedAt} now={now} online={online} what="calendar" canGoStale={false} />
    </div>
  )
}

export default function CalendarPageClient({
  events,
  currentMonth,
  currentYear,
  importEnabled = false,
  monthFromUrl = true,
}: CalendarPageClientProps) {
  const [importOpen, setImportOpen] = React.useState(false)
  const [imported, setImported] = React.useState<{ result: ImportCommitResult; at: number } | null>(null)
  const router = useRouter()

  // No month in the URL: the server used its UTC month. Move to the viewer's
  // local month when that differs (near a month boundary, O-31).
  React.useEffect(() => {
    if (monthFromUrl) return
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    if (year !== currentYear || month !== currentMonth) router.replace(calendarMonthHref(year, month))
  }, [monthFromUrl, currentYear, currentMonth, router])

  const onImported = (result: ImportCommitResult) => {
    setImportOpen(false)
    setImported({ result, at: Date.now() })
    router.refresh()
  }

  // The server sends the UTC month plus a day each side; keep the viewer's
  // local month only. The server renders in UTC, so the first render keeps the
  // UTC month too and the local filter applies after hydration; otherwise the
  // server and browser lists could differ near a month edge.
  // Day headers and times follow the same rule (see formatDayLabel).
  const now = useLocalNow()
  const hydrated = now !== null
  const monthEvents = events.filter((e) =>
    hydrated ? isInLocalMonth(e.start_time, currentYear, currentMonth) : isInUtcMonth(e.start_time, currentYear, currentMonth)
  )
  const grouped = groupEventsByDay(monthEvents, hydrated)
  const sortedDays = Array.from(grouped.keys()).sort()

  return (
    <div className="pb-20">
      <LargeHeader
        title="Calendar"
        subtitle={monthLabel(currentYear, currentMonth)}
        trailing={
          <Link href="/dashboard/calendar/create" className="btn-filled shrink-0" aria-label="Add event">
            <Plus className="w-4 h-4" aria-hidden="true" />
          </Link>
        }
        className="px-4"
      />

      <CalendarSyncLine events={events} />

      <div className="px-4 mb-4">
        <MonthNav year={currentYear} month={currentMonth} />
      </div>

      <div className="px-4 mb-5">
        <CaptureBox onSaved={() => router.refresh()} />
      </div>

      {importEnabled && (
        <div className="px-4 mb-5">
          <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={() => setImportOpen(true)}>
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>Import from text or photo</span>
          </button>
        </div>
      )}
      {importOpen && <ImportEventsDialog onClose={() => setImportOpen(false)} onDone={onImported} />}
      {imported && (
        <ImportUndoToast
          key={imported.at}
          result={imported.result}
          addedAt={imported.at}
          onDismiss={() => setImported(null)}
          onUndone={() => router.refresh()}
        />
      )}

      <div className="space-y-5 px-4">
        {sortedDays.length === 0 ? (
          <EmptyState
            icon={CalendarIcon}
            glyphColor="calendar"
            title="No events"
            description="Add events to your family's shared calendar."
            action={
              <Link href="/dashboard/calendar/create" className="btn-tinted mt-2">
                <Plus className="w-4 h-4" />
                Add Event
              </Link>
            }
          />
        ) : (
          sortedDays.map((dayKey) => {
            const dayEvents = grouped.get(dayKey) || []
            return (
              <section key={dayKey}>
                <p className="section-header">{formatDayLabel(dayEvents[0].start_time, now)}</p>
                <div className="list-inset stagger">
                  {dayEvents.map((event, i) => {
                    const time = now ? formatTime(event.start_time) : null
                    const subtitle = [time, event.location].filter(Boolean).join(' · ') || undefined
                    // Imported events are read-only: no edit link, and a text
                    // badge naming the source (not colour alone).
                    if (event.source) {
                      return (
                        <ListRow
                          key={event.id}
                          icon={CalendarIcon}
                          glyphColor="calendar"
                          title={event.title}
                          subtitle={subtitle}
                          showChevron={false}
                          trailing={<SourceBadge name={event.source.name} color={event.source.color} />}
                          className={cn(i === dayEvents.length - 1 && 'border-b-0')}
                        />
                      )
                    }
                    return (
                      <ListRow
                        key={event.id}
                        icon={CalendarIcon}
                        glyphColor="calendar"
                        title={event.title}
                        subtitle={subtitle}
                        showChevron={true}
                        href={`/dashboard/calendar/edit?id=${event.id}`}
                        trailing={
                          event.event_type && event.event_type !== 'other' ? (
                            <span className="text-caption-1 text-label-tertiary capitalize">
                              {event.event_type}
                            </span>
                          ) : undefined
                        }
                        className={cn(i === dayEvents.length - 1 && 'border-b-0')}
                      />
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

/**
 * "Added N events" with Undo (#270). Undo sends the import's signed undo token
 * (POST /api/calendar/import-suggestions/undo verifies it is this person's
 * import and at most 10 minutes old, then removes exactly those events), so it
 * is offered only while that window is open.
 */
export function ImportUndoToast({
  result,
  addedAt,
  onDismiss,
  onUndone,
}: {
  result: ImportCommitResult
  /** When the page received the result; Undo closes at the earlier of this + 10 min and the server's expiry. */
  addedAt: number
  onDismiss: () => void
  onUndone: () => void
}) {
  const [state, setState] = React.useState<
    { kind: 'added' } | { kind: 'undoing' } | { kind: 'undone'; count: number } | { kind: 'error'; message: string }
  >({ kind: 'added' })
  const closesAt = Math.min(addedAt + IMPORT_UNDO_WINDOW_MS, Date.parse(result.undoExpiresAt) || addedAt + IMPORT_UNDO_WINDOW_MS)
  const [undoOpen, setUndoOpen] = React.useState(() => Date.now() < closesAt)

  React.useEffect(() => {
    const remaining = closesAt - Date.now()
    if (remaining <= 0) return
    const t = setTimeout(() => setUndoOpen(false), remaining)
    return () => clearTimeout(t)
  }, [closesAt])

  const undo = async () => {
    setState({ kind: 'undoing' })
    try {
      const res = await fetch('/api/calendar/import-suggestions/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: result.undoToken }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setState({ kind: 'undone', count: typeof body?.removedCount === 'number' ? body.removedCount : 0 })
        setUndoOpen(false)
        onUndone()
        return
      }
      if (res.status === 409 || res.status === 403) setUndoOpen(false)
      setState({
        kind: 'error',
        message: typeof body?.error?.message === 'string' ? body.error.message : 'Could not undo. Try again.',
      })
    } catch {
      setState({ kind: 'error', message: 'Could not undo. Check your connection and try again.' })
    }
  }

  const n = result.count
  const title =
    state.kind === 'undone'
      ? `Removed ${state.count} event${state.count === 1 ? '' : 's'}`
      : `Added ${n} event${n === 1 ? '' : 's'}`

  return (
    <div className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md sm:bottom-6" data-testid="import-toast">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-3 shadow-lg"
      >
        <div className="flex-1 min-w-0">
          <p className="text-subhead font-semibold text-label-primary break-words">{title}</p>
          {state.kind === 'error' && <p className="text-footnote text-[var(--danger-text)] break-words">{state.message}</p>}
        </div>
        {undoOpen && (state.kind === 'added' || state.kind === 'undoing' || state.kind === 'error') && (
          <button
            type="button"
            onClick={undo}
            disabled={state.kind === 'undoing'}
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center gap-1 rounded-lg text-subhead font-semibold text-[var(--accent)] active:bg-[var(--surface-fill)]"
          >
            <Undo2 className="w-4 h-4" aria-hidden="true" />
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[var(--surface-fill)]"
        >
          <X className="w-4 h-4 text-label-tertiary" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
