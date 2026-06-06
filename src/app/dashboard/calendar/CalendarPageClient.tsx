'use client'

import * as React from 'react'
import { Plus, Calendar as CalendarIcon } from 'lucide-react'
import Link from 'next/link'
import { ListRow, InsetList } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { cn } from '@/lib/utils'

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
}

interface CalendarPageClientProps {
  events: EventData[]
  currentMonth: number
  currentYear: number
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

export default function CalendarPageClient({
  events,
  currentMonth,
  currentYear,
}: CalendarPageClientProps) {
  const [view, setView] = React.useState<ViewMode>('day')

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
          <Link href="/dashboard/calendar/create" className="btn-filled shrink-0">
            <Plus className="w-4 h-4" />
          </Link>
        }
        className="px-4"
      />

      <div className="px-4 mb-4">
        <SegmentedControl value={view} onChange={setView} />
      </div>

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
                  {dayEvents.map((event, i) => (
                    <ListRow
                      key={event.id}
                      icon={CalendarIcon}
                      glyphColor="calendar"
                      title={event.title}
                      subtitle={
                        event.location
                          ? `${formatTime(event.start_time)} · ${event.location}`
                          : formatTime(event.start_time)
                      }
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
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}