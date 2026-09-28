'use client'

import * as React from 'react'
import { Plus, Calendar as CalendarIcon, Sparkles, Undo2, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ListRow, InsetList } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { CaptureBox } from '@/components/capture/CaptureBox'
import { cn } from '@/lib/utils'
import { IMPORT_UNDO_WINDOW_MS, type ImportCommitResult } from '@/lib/event-import-client'
import { ImportEventsDialog } from './ImportEventsDialog'

type ViewMode = 'day' | 'week' | 'month'

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
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toDateString()
}

function groupEventsByDay(events: EventData[]): Map<string, EventData[]> {
  const map = new Map<string, EventData[]>()
  for (const event of events) {
    const key = getDateKey(event.start_time)
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

export default function CalendarPageClient({
  events,
  currentMonth,
  currentYear,
  importEnabled = false,
}: CalendarPageClientProps) {
  const [view, setView] = React.useState<ViewMode>('day')
  const [importOpen, setImportOpen] = React.useState(false)
  const [imported, setImported] = React.useState<{ result: ImportCommitResult; at: number } | null>(null)
  const router = useRouter()

  const onImported = (result: ImportCommitResult) => {
    setImportOpen(false)
    setImported({ result, at: Date.now() })
    router.refresh()
  }

  const SegmentedControl = ({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) => (
    <div className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1">
      {(['day', 'week', 'month'] as ViewMode[]).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all duration-200',
            value === opt
              ? 'bg-[var(--surface-elevated)] text-label-primary shadow-sm'
              : 'text-label-secondary hover:text-label-primary'
          )}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  )

  const grouped = groupEventsByDay(events)
  const sortedDays = Array.from(grouped.keys()).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  )

  return (
    <div className="pb-20">
      <LargeHeader
        title="Calendar"
        subtitle={new Date(currentYear, currentMonth - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        trailing={
          <Link href="/dashboard/calendar/create" className="btn-filled shrink-0" aria-label="Add event">
            <Plus className="w-4 h-4" />
          </Link>
        }
        className="px-4"
      />

      <div className="px-4 mb-4">
        <SegmentedControl value={view} onChange={setView} />
      </div>

      <div className="px-4 mb-5">
        <CaptureBox />
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
                <p className="section-header">{formatDayLabel(dayEvents[0].start_time)}</p>
                <div className="list-inset stagger">
                  {dayEvents.map((event, i) => {
                    const subtitle = event.location
                      ? `${formatTime(event.start_time)} · ${event.location}`
                      : formatTime(event.start_time)
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
