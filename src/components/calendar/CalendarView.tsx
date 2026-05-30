'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Clock,
  CheckCircle2,
  Circle,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EVENT_COLORS } from '@/lib/constants'

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'month' | 'week' | 'day'

interface EventData {
  id: string
  title: string
  description?: string | null
  start_time: string
  end_time: string
  location?: string | null
  event_type: string
  is_task: boolean
  project_id?: string | null
  recurrence?: string | null
  created_by: string
  created_at: string
  creator?: { name: string } | null
}

interface ChoreData {
  id: string
  title: string
  description?: string | null
  points: number
  assigned_to: string
  due_date: string
  status: string
  frequency: string
  difficulty: string
  created_by: string
  created_at: string
  completed_at?: string | null
  verified_at?: string | null
  assignee?: { name: string } | null
}

interface CalendarViewProps {
  events: EventData[]
  chores: ChoreData[]
  familyId: string
  currentMonth: number
  currentYear: number
  userRole: string
}

interface DayCell {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
}

interface ModalState {
  open: boolean
  event?: EventData | null
  prefilledDate?: Date | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_TYPE_COLORS: Record<string, string> = {
  school: EVENT_COLORS.SCHOOL,
  sports: EVENT_COLORS.SPORTS,
  appointment: EVENT_COLORS.APPOINTMENT,
  family: EVENT_COLORS.FAMILY,
  work: EVENT_COLORS.WORK,
  other: EVENT_COLORS.OTHER,
}

const CHORE_COLOR = '#F59E0B' // amber
const HOUR_HEIGHT = 64
const HOUR_START = 6
const HOUR_END = 22 // 10pm
const TOTAL_HOURS = HOUR_END - HOUR_START

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Date Helpers ────────────────────────────────────────────────────────────

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date())
}

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  date.setDate(date.getDate() - day)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

function getTimeString(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function getHourMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

// ─── Build Month Grid ────────────────────────────────────────────────────────

function buildMonthGrid(year: number, month: number): DayCell[] {
  const firstDay = startOfMonth(year, month)
  const startDayOfWeek = firstDay.getDay() // 0 = Sun
  const totalDays = daysInMonth(year, month)
  const prevMonthDays = daysInMonth(year, month - 1 || 12)

  const cells: DayCell[] = []

  // Previous month trailing days
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(prevYear, prevMonth - 1, prevMonthDays - i)
    cells.push({ date: d, isCurrentMonth: false, isToday: isToday(d) })
  }

  // Current month days
  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(year, month - 1, i)
    cells.push({ date: d, isCurrentMonth: true, isToday: isToday(d) })
  }

  // Next month leading days (fill to 42 cells)
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const remaining = 42 - cells.length
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(nextYear, nextMonth - 1, i)
    cells.push({ date: d, isCurrentMonth: false, isToday: isToday(d) })
  }

  return cells
}

// ─── Group Events by Overlap (for week/day columns) ──────────────────────────

interface PositionedBlock {
  id: string
  title: string
  start: Date
  end: Date
  color: string
  isChore: boolean
  choreStatus?: string
  eventType?: string
  data: EventData | ChoreData
  column: number
  totalColumns: number
  top: number
  height: number
}

function positionBlocks(
  items: (EventData | ChoreData)[],
  isChoreMap: Map<string, boolean>,
): PositionedBlock[] {
  if (items.length === 0) return []

  const blocks: PositionedBlock[] = []
  const now = new Date()

  for (const item of items) {
    const isChore = isChoreMap.get(item.id) ?? false
    let start: Date
    let end: Date

    if (isChore) {
      const chore = item as ChoreData
      // Chores default to 9:00-9:30 AM on their due date
      start = new Date(chore.due_date)
      start.setHours(9, 0, 0, 0)
      end = new Date(start)
      end.setMinutes(30)
    } else {
      const event = item as EventData
      start = new Date(event.start_time)
      end = new Date(event.end_time)
      if (end.getTime() - start.getTime() < 30 * 60 * 1000) {
        end = new Date(start.getTime() + 30 * 60 * 1000) // minimum 30 min
      }
    }

    const startMinutes = Math.max(getHourMinutes(start), HOUR_START * 60)
    const endMinutes = Math.min(getHourMinutes(end), HOUR_END * 60)

    const top = ((startMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT
    const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 20)

    const color = isChore
      ? CHORE_COLOR
      : EVENT_TYPE_COLORS[(item as EventData).event_type] || EVENT_TYPE_COLORS.other

    blocks.push({
      id: item.id,
      title: item.title,
      start,
      end,
      color,
      isChore,
      choreStatus: isChore ? (item as ChoreData).status : undefined,
      eventType: !isChore ? (item as EventData).event_type : undefined,
      data: item,
      column: 0,
      totalColumns: 1,
      top,
      height,
    })
  }

  // Sort by start time then by duration (longer first)
  blocks.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime() - (b.end.getTime() - b.start.getTime()))

  // Assign columns (simple overlap grouping)
  const groups: PositionedBlock[][] = []
  for (const block of blocks) {
    let placed = false
    for (const group of groups) {
      // Check if block overlaps with any in this group
      const overlaps = group.some(
        (g) => block.start < g.end && block.end > g.start,
      )
      if (overlaps) continue
      group.push(block)
      placed = true
      break
    }
    if (!placed) {
      groups.push([block])
    }
  }

  // For each group, assign column indices
  for (const group of groups) {
    // Sort group by start time
    group.sort((a, b) => a.start.getTime() - b.start.getTime())

    // Assign to columns (greedy: put each event in the first available column)
    const columns: PositionedBlock[][] = []
    for (const block of group) {
      let colIdx = 0
      while (colIdx < columns.length) {
        const lastInCol = columns[colIdx][columns[colIdx].length - 1]
        if (lastInCol.end <= block.start) break
        colIdx++
      }
      if (colIdx >= columns.length) columns.push([])
      columns[colIdx].push(block)
      block.column = colIdx
    }
    const totalCols = columns.length
    for (const block of group) {
      block.totalColumns = totalCols
    }
  }

  return blocks
}

// ─── Event Modal Component ───────────────────────────────────────────────────

function EventModal({
  open,
  onClose,
  onSave,
  onDelete,
  event,
  prefilledDate,
  userRole,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: Record<string, unknown>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  event?: EventData | null
  prefilledDate?: Date | null
  userRole: string
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [eventType, setEventType] = useState('other')
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
      if (event) {
        setTitle(event.title)
        setDescription(event.description || '')
        const start = new Date(event.start_time)
        setStartDate(start.toISOString().split('T')[0])
        setStartTime(start.toTimeString().slice(0, 5))
        if (event.end_time) {
          const end = new Date(event.end_time)
          setEndDate(end.toISOString().split('T')[0])
          setEndTime(end.toTimeString().slice(0, 5))
        } else {
          setEndDate('')
          setEndTime('')
        }
        setLocation(event.location || '')
        setEventType(event.event_type || 'other')
      } else {
        setTitle('')
        setDescription('')
        const baseDate = prefilledDate || new Date()
        setStartDate(baseDate.toISOString().split('T')[0])
        setStartTime(prefilledDate ? baseDate.toTimeString().slice(0, 5) : '09:00')
        setEndDate('')
        setEndTime('')
        setLocation('')
        setEventType('other')
      }
    }
  }, [open, event, prefilledDate])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const startDateTime = `${startDate}T${startTime || '00:00'}:00`
      const endDateTime = endDate ? `${endDate}T${endTime || '23:59'}:00` : startDateTime

      if (new Date(endDateTime) < new Date(startDateTime)) {
        setError('End must be after start')
        setLoading(false)
        return
      }

      await onSave({
        eventId: event?.id,
        title,
        description: description || null,
        start_time: startDateTime,
        end_time: endDateTime,
        location: location || null,
        event_type: eventType,
      })

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!event?.id || !confirm('Delete this event?')) return
    setDeleting(true)
    try {
      await onDelete(event.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b rounded-t-2xl px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {event ? 'Edit Event' : 'New Event'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Event title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[80px]"
              placeholder="Add details..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Home, School"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="school">🎓 School</option>
              <option value="sports">⚽ Sports</option>
              <option value="appointment">🩺 Appointment</option>
              <option value="family">👨‍👩‍👧‍👦 Family</option>
              <option value="work">💼 Work</option>
              <option value="other">📌 Other</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <div>
              {event && userRole === 'parent' && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-red-600 hover:text-red-700 text-sm font-medium flex items-center gap-1.5 px-3 py-2 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 className="w-4 h-4" />
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !title || !startDate}
                className="btn-primary text-sm"
              >
                {loading ? 'Saving...' : event ? 'Save Changes' : 'Create Event'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main CalendarView Component ─────────────────────────────────────────────

export default function CalendarView({
  events,
  chores,
  familyId,
  currentMonth,
  currentYear,
  userRole,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date()
    return new Date(currentYear, currentMonth - 1, now.getDate() > daysInMonth(currentYear, currentMonth) ? 1 : now.getDate())
  })
  const [modal, setModal] = useState<ModalState>({ open: false })
  const [currentTime, setCurrentTime] = useState(new Date())
  const router = useRouter()

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const displayMonth = viewDate.getMonth() + 1
  const displayYear = viewDate.getFullYear()

  // ─── Navigation ────────────────────────────────────────────────────────

  const goToToday = useCallback(() => {
    const now = new Date()
    setViewDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  }, [])

  const navigateBack = useCallback(() => {
    if (viewMode === 'month') {
      setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    } else if (viewMode === 'week') {
      setViewDate((d) => addDays(d, -7))
    } else {
      setViewDate((d) => addDays(d, -1))
    }
  }, [viewMode])

  const navigateForward = useCallback(() => {
    if (viewMode === 'month') {
      setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    } else if (viewMode === 'week') {
      setViewDate((d) => addDays(d, 7))
    } else {
      setViewDate((d) => addDays(d, 1))
    }
  }, [viewMode])

  // Switch to day view for a specific date
  const goToDay = useCallback((date: Date) => {
    setViewDate(date)
    setViewMode('day')
  }, [])

  // ─── Data Helpers ──────────────────────────────────────────────────────

  const getEventsForDay = useCallback(
    (date: Date) => {
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      return events.filter((e) => {
        const start = new Date(e.start_time)
        return start >= dayStart && start < dayEnd
      })
    },
    [events],
  )

  const getChoresForDay = useCallback(
    (date: Date) => {
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      return chores.filter((c) => {
        const due = new Date(c.due_date)
        return due >= dayStart && due < dayEnd
      })
    },
    [chores],
  )

  // ─── API Calls ─────────────────────────────────────────────────────────

  const handleSaveEvent = useCallback(
    async (data: Record<string, unknown>) => {
      const method = data.eventId ? 'PATCH' : 'POST'
      const res = await fetch('/api/events', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save event')
      router.refresh()
    },
    [],
  )

  const handleDeleteEvent = useCallback(async (id: string) => {
    const res = await fetch('/api/events', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: id }),
    })
    if (!res.ok) {
      const result = await res.json()
      throw new Error(result.error || 'Failed to delete')
    }
    router.refresh()
  }, [])

  const handleCompleteChore = useCallback(async (choreId: string, completed: boolean) => {
    if (completed) {
      const res = await fetch('/api/chores/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId }),
      })
      if (!res.ok) {
        const result = await res.json()
        throw new Error(result.error || 'Failed to complete chore')
      }
    }
    router.refresh()
  }, [])

  const openAddModal = useCallback((prefilledDate?: Date) => {
    setModal({ open: true, event: null, prefilledDate: prefilledDate || null })
  }, [])

  const openEditModal = useCallback((event: EventData) => {
    setModal({ open: true, event, prefilledDate: null })
  }, [])

  // ─── Computed Data ────────────────────────────────────────────────────

  const monthGrid = useMemo(
    () => buildMonthGrid(displayYear, displayMonth),
    [displayYear, displayMonth],
  )

  const weekDays = useMemo(() => {
    const start = startOfWeek(viewDate)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [viewDate])

  // Events for week/day views with chore integration
  const weekItems = useMemo(() => {
    const weekStart = startOfWeek(viewDate)
    const weekEnd = addDays(weekStart, 7)
    const filteredEvents = events.filter((e) => {
      const s = new Date(e.start_time)
      return s >= weekStart && s < weekEnd
    })
    const filteredChores = chores.filter((c) => {
      const d = new Date(c.due_date)
      return d >= weekStart && d < weekEnd
    })
    return { events: filteredEvents, chores: filteredChores }
  }, [events, chores, viewDate])

  const dayItems = useMemo(() => {
    const dayStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate())
    const dayEnd = addDays(dayStart, 1)
    const filteredEvents = events.filter((e) => {
      const s = new Date(e.start_time)
      return s >= dayStart && s < dayEnd
    })
    const filteredChores = chores.filter((c) => {
      const d = new Date(c.due_date)
      return d >= dayStart && d < dayEnd
    })
    return { events: filteredEvents, chores: filteredChores }
  }, [events, chores, viewDate])

  // ─── Header Label ─────────────────────────────────────────────────────

  const headerLabel = useMemo(() => {
    if (viewMode === 'month') {
      return `${MONTH_NAMES[displayMonth - 1]} ${displayYear}`
    }
    if (viewMode === 'week') {
      const start = startOfWeek(viewDate)
      const end = addDays(start, 6)
      if (start.getMonth() === end.getMonth()) {
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`
      }
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
    }
    // day
    const dayName = DAY_NAMES_FULL[viewDate.getDay()]
    return `${dayName}, ${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getDate()}, ${viewDate.getFullYear()}`
  }, [viewMode, displayMonth, displayYear, viewDate])

  // ─── Current Time Line Position ────────────────────────────────────────

  const currentTimeTop = useMemo(() => {
    const minutes = getHourMinutes(currentTime)
    const clampedMinutes = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, minutes))
    return ((clampedMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT
  }, [currentTime])

  const showTimeLine = useMemo(() => {
    if (viewMode === 'month') return false
    const now = new Date()
    if (viewMode === 'day') {
      return isSameDay(viewDate, now)
    }
    // week view: check if today is in the current week
    const weekStart = startOfWeek(viewDate)
    const weekEnd = addDays(weekStart, 7)
    return now >= weekStart && now < weekEnd
  }, [viewMode, viewDate])

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white rounded-xl border shadow-sm p-1">
            {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize',
                  viewMode === mode
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition border border-gray-200"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={navigateBack}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
              {headerLabel}
            </h2>
            <button
              onClick={navigateForward}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          <button
            onClick={() => openAddModal()}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Event</span>
          </button>
        </div>
      </div>

      {/* Calendar Content */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        {viewMode === 'month' && (
          <MonthView
            grid={monthGrid}
            getEventsForDay={getEventsForDay}
            getChoresForDay={getChoresForDay}
            onDayClick={goToDay}
            onSlotClick={openAddModal}
          />
        )}

        {viewMode === 'week' && (
          <WeekView
            days={weekDays}
            events={weekItems.events}
            chores={weekItems.chores}
            currentTimeTop={currentTimeTop}
            showTimeLine={showTimeLine}
            onDayClick={goToDay}
            onSlotClick={openAddModal}
            onEventClick={openEditModal}
            onCompleteChore={handleCompleteChore}
          />
        )}

        {viewMode === 'day' && (
          <DayView
            date={viewDate}
            events={dayItems.events}
            chores={dayItems.chores}
            currentTimeTop={currentTimeTop}
            showTimeLine={showTimeLine}
            onSlotClick={openAddModal}
            onEventClick={openEditModal}
            onCompleteChore={handleCompleteChore}
          />
        )}
      </div>

      {/* Event Modal */}
      <EventModal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
        event={modal.event}
        prefilledDate={modal.prefilledDate}
        userRole={userRole}
      />
    </div>
  )
}

// ─── MonthView Sub-Component ──────────────────────────────────────────────────

function MonthView({
  grid,
  getEventsForDay,
  getChoresForDay,
  onDayClick,
  onSlotClick,
}: {
  grid: DayCell[]
  getEventsForDay: (date: Date) => EventData[]
  getChoresForDay: (date: Date) => ChoreData[]
  onDayClick: (date: Date) => void
  onSlotClick: (date?: Date) => void
}) {
  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {grid.map((cell, idx) => {
          const eventsForDay = getEventsForDay(cell.date)
          const choresForDay = getChoresForDay(cell.date)
          const totalItems = eventsForDay.length + choresForDay.length

          return (
            <button
              key={idx}
              onClick={() => onDayClick(cell.date)}
              onContextMenu={(e) => {
                e.preventDefault()
                onSlotClick(cell.date)
              }}
              className={cn(
                'min-h-[100px] sm:min-h-[120px] p-1.5 border-b border-r transition-colors hover:bg-blue-50/50 text-left',
                !cell.isCurrentMonth && 'bg-gray-50/50',
              )}
            >
              {/* Date number */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={cn(
                    'text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full',
                    cell.isToday && 'bg-blue-600 text-white',
                    !cell.isToday && cell.isCurrentMonth && 'text-gray-900',
                    !cell.isCurrentMonth && 'text-gray-400',
                  )}
                >
                  {cell.date.getDate()}
                </span>
              </div>

              {/* Event dots */}
              <div className="space-y-0.5">
                {eventsForDay.slice(0, 3).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-xs truncate"
                    style={{
                      backgroundColor:
                        EVENT_TYPE_COLORS[event.event_type] + '18',
                      color: EVENT_TYPE_COLORS[event.event_type],
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: EVENT_TYPE_COLORS[event.event_type],
                      }}
                    />
                    <span className="truncate font-medium">{event.title}</span>
                  </div>
                ))}

                {choresForDay.slice(0, eventsForDay.length === 0 ? 3 : Math.max(0, 3 - eventsForDay.length)).map((chore) => (
                  <div
                    key={chore.id}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-xs truncate"
                    style={{ backgroundColor: CHORE_COLOR + '18', color: CHORE_COLOR }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CHORE_COLOR }}
                    />
                    <span className="truncate font-medium">{chore.title}</span>
                  </div>
                ))}

                {totalItems > 3 && (
                  <div className="text-xs text-gray-500 font-medium px-1.5">
                    +{totalItems - 3} more
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Mobile: switch to week/day */}
      <div className="sm:hidden text-center py-3 border-t text-xs text-gray-500">
        Tap a day to see details &middot; Long-press to add event
      </div>
    </div>
  )
}

// ─── WeekView Sub-Component ───────────────────────────────────────────────────

function WeekView({
  days,
  events,
  chores,
  currentTimeTop,
  showTimeLine,
  onDayClick,
  onSlotClick,
  onEventClick,
  onCompleteChore,
}: {
  days: Date[]
  events: EventData[]
  chores: ChoreData[]
  currentTimeTop: number
  showTimeLine: boolean
  onDayClick: (date: Date) => void
  onSlotClick: (date?: Date) => void
  onEventClick: (event: EventData) => void
  onCompleteChore: (choreId: string, completed: boolean) => Promise<void>
}) {
  return (
    <div className="flex flex-col h-[600px] overflow-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-10 bg-white border-b flex">
        {/* Time gutter */}
        <div className="w-14 flex-shrink-0" />
        {days.map((day, idx) => {
          const isTodayDay = isToday(day)
          return (
            <button
              key={idx}
              onClick={() => onDayClick(day)}
              className="flex-1 py-2 text-center border-r last:border-r-0 hover:bg-gray-50 transition"
            >
              <div className="text-xs text-gray-500 font-medium">{DAY_NAMES[day.getDay()]}</div>
              <div
                className={cn(
                  'text-lg font-semibold mt-0.5',
                  isTodayDay
                    ? 'bg-blue-600 text-white w-9 h-9 rounded-full flex items-center justify-center mx-auto'
                    : 'text-gray-900',
                )}
              >
                {day.getDate()}
              </div>
            </button>
          )
        })}
      </div>

      {/* Hour rows */}
      <div className="flex-1 relative">
        {/* Time labels */}
        <div className="absolute left-0 top-0 bottom-0 w-14 z-10 bg-white">
          {Array.from({ length: TOTAL_HOURS }, (_, i) => {
            const hour = HOUR_START + i
            const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`
            return (
              <div
                key={i}
                className="h-[64px] flex items-start justify-end pr-2"
              >
                <span className="text-[10px] text-gray-400 -mt-1.5">{label}</span>
              </div>
            )
          })}
        </div>

        {/* Day columns */}
        <div className="ml-14 flex h-full relative">
          {days.map((day, dayIdx) => {
            const dayEvents = events.filter((e) => isSameDay(new Date(e.start_time), day))
            const dayChores = chores.filter((c) => isSameDay(new Date(c.due_date), day))
            const isChoreMap = new Map<string, boolean>()
            dayChores.forEach((c) => isChoreMap.set(c.id, true))
            dayEvents.forEach((e) => isChoreMap.set(e.id, false))

            const allItems: (EventData | ChoreData)[] = [...dayEvents, ...dayChores]
            const positionedBlocks = positionBlocks(allItems, isChoreMap)

            return (
              <div
                key={dayIdx}
                className="flex-1 border-r last:border-r-0 relative"
                onClick={(e) => {
                  // Only trigger if clicking on empty space
                  if (e.target === e.currentTarget) {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const hour = Math.floor(y / HOUR_HEIGHT) + HOUR_START
                    const clickedDate = new Date(day)
                    clickedDate.setHours(hour, 0, 0, 0)
                    onSlotClick(clickedDate)
                  }
                }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="border-t border-gray-100"
                    style={{ height: i === TOTAL_HOURS ? 0 : HOUR_HEIGHT }}
                  />
                ))}

                {/* Current time line */}
                {showTimeLine && isToday(day) && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: currentTimeTop }}
                  >
                    <div className="flex items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5" />
                      <div className="flex-1 border-t border-red-500" />
                    </div>
                  </div>
                )}

                {/* Event blocks */}
                {positionedBlocks.map((block) => {
                  const width = `${100 / block.totalColumns}%`
                  const left = `${(block.column / block.totalColumns) * 100}%`
                  const isChore = block.isChore
                  const isCompleted = block.choreStatus === 'completed' || block.choreStatus === 'verified'

                  return (
                    <div
                      key={block.id}
                      className={cn(
                        'absolute rounded-lg px-1.5 py-0.5 overflow-hidden cursor-pointer transition-shadow hover:shadow-md border border-white/20',
                        isChore && 'border-2',
                        isChore && isCompleted && 'opacity-50 line-through',
                      )}
                      style={{
                        top: block.top,
                        height: Math.max(block.height, 20),
                        width,
                        left,
                        backgroundColor: block.color + '22',
                        borderColor: block.color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isChore) {
                          onCompleteChore(block.id, !isCompleted)
                        } else {
                          onEventClick(block.data as EventData)
                        }
                      }}
                    >
                      <div className="flex items-center gap-1">
                        {isChore && (
                          isCompleted ? (
                            <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: block.color }} />
                          ) : (
                            <Circle className="w-3 h-3 flex-shrink-0" style={{ color: block.color }} />
                          )
                        )}
                        <span
                          className="text-xs font-semibold truncate"
                          style={{ color: block.color }}
                        >
                          {block.title}
                        </span>
                      </div>
                      {block.height >= 36 && !isChore && (
                        <div className="text-[10px] mt-0.5 text-gray-500">
                          {getTimeString(block.start)}
                          {block.end.getTime() - block.start.getTime() > 30 * 60 * 1000 &&
                            ` – ${getTimeString(block.end)}`}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── DayView Sub-Component ────────────────────────────────────────────────────

function DayView({
  date,
  events,
  chores,
  currentTimeTop,
  showTimeLine,
  onSlotClick,
  onEventClick,
  onCompleteChore,
}: {
  date: Date
  events: EventData[]
  chores: ChoreData[]
  currentTimeTop: number
  showTimeLine: boolean
  onSlotClick: (date?: Date) => void
  onEventClick: (event: EventData) => void
  onCompleteChore: (choreId: string, completed: boolean) => Promise<void>
}) {
  const isChoreMap = new Map<string, boolean>()
  chores.forEach((c) => isChoreMap.set(c.id, true))
  events.forEach((e) => isChoreMap.set(e.id, false))

  const allItems: (EventData | ChoreData)[] = [...events, ...chores]
  const positionedBlocks = positionBlocks(allItems, isChoreMap)

  return (
    <div className="flex flex-col h-[600px] overflow-auto">
      {/* Day header */}
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold',
              isToday(date)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-900',
            )}
          >
            {date.getDate()}
          </div>
          <div>
            <div className="font-semibold text-gray-900">
              {DAY_NAMES_FULL[date.getDay()]}
            </div>
            <div className="text-sm text-gray-500">
              {MONTH_NAMES[date.getMonth()]} {date.getFullYear()}
            </div>
          </div>
        </div>
      </div>

      {/* Hour rows */}
      <div className="flex-1 relative">
        {/* Time labels */}
        <div className="absolute left-0 top-0 bottom-0 w-14 z-10 bg-white">
          {Array.from({ length: TOTAL_HOURS }, (_, i) => {
            const hour = HOUR_START + i
            const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`
            return (
              <div
                key={i}
                className="h-[64px] flex items-start justify-end pr-2"
              >
                <span className="text-[10px] text-gray-400 -mt-1.5">{label}</span>
              </div>
            )
          })}
        </div>

        {/* Day column */}
        <div
          className="ml-14 relative"
          style={{ minHeight: TOTAL_HOURS * HOUR_HEIGHT }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              const rect = e.currentTarget.getBoundingClientRect()
              const y = e.clientY - rect.top
              const hour = Math.floor(y / HOUR_HEIGHT) + HOUR_START
              const clickedDate = new Date(date)
              clickedDate.setHours(hour, 0, 0, 0)
              onSlotClick(clickedDate)
            }
          }}
        >
          {/* Hour grid lines */}
          {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
            <div
              key={i}
              className="border-t border-gray-100"
              style={{ height: i === TOTAL_HOURS ? 0 : HOUR_HEIGHT }}
            />
          ))}

          {/* Current time line */}
          {showTimeLine && (
            <div
              className="absolute left-0 right-0 z-20 pointer-events-none"
              style={{ top: currentTimeTop }}
            >
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5" />
                <div className="flex-1 border-t border-red-500" />
              </div>
            </div>
          )}

          {/* Event blocks */}
          {positionedBlocks.map((block) => {
            const width = `${100 / block.totalColumns}%`
            const left = `${(block.column / block.totalColumns) * 100}%`
            const isChore = block.isChore
            const isCompleted = block.choreStatus === 'completed' || block.choreStatus === 'verified'

            return (
              <div
                key={block.id}
                className={cn(
                  'absolute rounded-xl px-2 py-1.5 overflow-hidden cursor-pointer transition-shadow hover:shadow-md border-2',
                  isChore && isCompleted && 'opacity-50',
                )}
                style={{
                  top: block.top,
                  height: Math.max(block.height, 24),
                  width,
                  left,
                  backgroundColor: block.color + '15',
                  borderColor: block.color,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isChore) {
                    onCompleteChore(block.id, !isCompleted)
                  } else {
                    onEventClick(block.data as EventData)
                  }
                }}
              >
                <div className="flex items-center gap-1.5">
                  {isChore ? (
                    isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: block.color }} />
                    ) : (
                      <Circle className="w-4 h-4 flex-shrink-0" style={{ color: block.color }} />
                    )
                  ) : (
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: block.color }}
                    />
                  )}
                  <span
                    className={cn(
                      'text-sm font-semibold truncate',
                      isCompleted && 'line-through',
                    )}
                    style={{ color: block.color }}
                  >
                    {block.title}
                  </span>
                </div>
                {block.height >= 44 && (
                  <div className="mt-1 space-y-0.5">
                    <div className="text-xs flex items-center gap-1" style={{ color: block.color }}>
                      <Clock className="w-3 h-3" />
                      {getTimeString(block.start)}
                      {block.end.getTime() - block.start.getTime() > 30 * 60 * 1000 &&
                        ` – ${getTimeString(block.end)}`}
                    </div>
                    {!isChore && (block.data as EventData).location && (
                      <div className="text-xs flex items-center gap-1" style={{ color: block.color }}>
                        <MapPin className="w-3 h-3" />
                        {(block.data as EventData).location}
                      </div>
                    )}
                    {isChore && (
                      <div className="text-xs" style={{ color: block.color }}>
                        {(block.data as ChoreData).points} pts
                        {block.choreStatus && ` · ${block.choreStatus}`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
