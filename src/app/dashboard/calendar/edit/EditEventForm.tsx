'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { format } from 'date-fns'
import { useTranslation } from '@/i18n'
import { calendarFormMessages, type CalendarFormMessage, type CalendarFormError } from '@/i18n/calendar-forms'
import { EventDuration } from '@/components/calendar/EventDuration'
import { eventFormRange } from '@/lib/dates'
import { Dialog } from '@/components/ui/dialog'

function EditEventForm({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const { t } = useTranslation()
  const message = (key: CalendarFormMessage, params?: Record<string, string | number>) => t(key, params, calendarFormMessages)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [duration, setDuration] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<CalendarFormError | null>(null)
  // Imported events (#232) are read-only; the API refuses edits with 409.
  const [source, setSource] = useState<{ name: string } | null>(null)
  // DELETE /api/events is parent-only (like PATCH). Unknown until
  // /api/auth/me answers, so Delete never flashes for a teen or child.
  const [isParent, setIsParent] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<CalendarFormError | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const originalTimes = useRef<{ eventId: string; start: string; end: string | null } | null>(null)
  const router = useRouter()
  useEffect(() => { onBusyChange?.(loading || deleting) }, [loading, deleting, onBusyChange])
  const searchParams = useSearchParams()
  const eventId = searchParams.get('id')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsParent(d?.user?.role === 'parent'))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let active = true
    originalTimes.current = null
    setFetching(true)
    setError(null)
    setTitle('')
    setDescription('')
    setStartDate('')
    setStartTime('')
    setEndDate('')
    setEndTime('')
    setDuration('')
    setLocation('')
    setSource(null)
    setConfirmOpen(false)
    if (!eventId) {
      setError({ key: 'noId' })
      setFetching(false)
      return
    }

    const fetchEvent = async () => {
      try {
        const res = await fetch(`/api/events?id=${encodeURIComponent(eventId)}`)
        if (!active) return
        if (res.ok) {
          const data = await res.json()
          if (!active) return
          const event = data.event
          if (event?.id !== eventId) throw new Error('EVENT_ID_MISMATCH')
          originalTimes.current = { eventId: event.id, start: event.start_time, end: event.end_time ?? null }
          setTitle(event.title)
          setDescription(event.description || '')
          // Populate the form in the user's local time
          const start = new Date(event.start_time)
          setStartDate(format(start, 'yyyy-MM-dd'))
          setStartTime(format(start, 'HH:mm'))
          if (event.end_time) {
            const end = new Date(event.end_time)
            setEndDate(format(end, 'yyyy-MM-dd'))
            setEndTime(format(end, 'HH:mm'))
          }
          setLocation(event.location || '')
          setSource(event.source ? { name: event.source.name } : null)
        } else if (res.status === 404) {
          setError({ key: 'notFound' })
        } else {
          setError({ key: 'loadFailed' })
        }
      } catch (err) {
        if (!active) return
        console.error('Error fetching event:', err)
        setError({ key: 'loadFailed' })
      } finally {
        if (active) setFetching(false)
      }
    }

    fetchEvent()
    return () => { active = false }
  }, [eventId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const original = originalTimes.current
    if (!eventId || !original || original.eventId !== eventId || fetching) return

    setLoading(true)
    setError(null)

    try {
      // Form values are local wall-clock time; send real ISO instants (with offset)
      // An end time without an end date is on the start day (src/lib/dates.ts).
      const range = eventFormRange(
        { startDate, startTime, endDate, endTime },
        original,
        duration === '' ? undefined : Number(duration)
      )
      const startDateTime = range?.start
      const endDateTime = range?.end

      if (!startDateTime || !endDateTime) {
        setError({ key: 'invalidTime' })
        setLoading(false)
        return
      }

      if (new Date(endDateTime) < new Date(startDateTime)) {
        setError({ key: 'endBeforeStart' })
        setLoading(false)
        return
      }

      const res = await fetch('/api/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          title,
          description: description || null,
          start_time: startDateTime,
          end_time: endDateTime,
          location: location || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ? { raw: data.error } : { key: 'updateFailed' })
        return
      }

      router.push('/dashboard/calendar')
      router.refresh()
    } catch (err) {
      setError({ key: 'unexpected' })
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!eventId || originalTimes.current?.eventId !== eventId || !isParent || source || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setDeleteError(typeof data?.error === 'string' ? { raw: data.error } : { key: 'deleteFailed' })
        return
      }
      setConfirmOpen(false)
      router.push('/dashboard/calendar')
      router.refresh()
    } catch {
      setDeleteError({ key: 'deleteConnection' })
    } finally {
      setDeleting(false)
    }
  }

  if (fetching) {
    return (
      <div className="flex items-center justify-center py-20">
        <CalendarLoading />
      </div>
    )
  }

  if (!eventId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <div className="card-apple p-8">
          <h2 className="text-title-2 text-label-primary mb-2">{message('noEvent')}</h2>
          <p className="text-body text-label-secondary mb-6">{message('selectEvent')}</p>
          <Link href="/dashboard/calendar" className="btn-filled">{message('back')}</Link>
        </div>
      </div>
    )
  }

  if (source) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="card-apple p-8">
          <h1 className="text-title-2 text-label-primary mb-2">{title}</h1>
          <p className="text-body text-label-secondary mb-2">{message('from', { source: source.name })}</p>
          <p className="text-body text-label-secondary mb-6">
            {message('readOnly')}
          </p>
          <Link href="/dashboard/calendar" className="btn-filled">{message('back')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className={inSheet ? "" : "max-w-xl mx-auto pb-20"}>
      {!inSheet && <>
      {/* Back nav */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/calendar" className="btn-plain text-base py-2">
          <ArrowLeft className="w-5 h-5" />
          <span>{message('calendar')}</span>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-large-title font-display">{message('editEvent')}</h1>
        <p className="text-subhead text-label-secondary mt-1">{message('editDescription')}</p>
      </div>

      </>}
      <form onSubmit={handleSubmit} className={inSheet ? "space-y-5" : "mt-6 space-y-5 px-4"}>

        {error && (
          <div className="card-apple p-4 border border-[var(--danger)]">
            <p role="alert" className="text-body text-[var(--danger-text)]">{'key' in error ? message(error.key) : error.raw}</p>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="label-apple" htmlFor="title">{message('title')}</label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-apple"
            placeholder={message('titlePlaceholder')}
          />
        </div>

        {/* Description */}
        <div>
          <label className="label-apple" htmlFor="description">{message('description')}</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-apple min-h-[80px] resize-none"
            placeholder={message('descriptionPlaceholder')}
            rows={3}
          />
        </div>

        {/* Start */}
        <div>
          <label className="label-apple" htmlFor="startDate">{message('start')}</label>
          <div className="grid grid-cols-2 gap-3">
            <input
              id="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-apple"
            />
            <input
              id="startTime"
              aria-label={message('startTime')}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="input-apple"
            />
          </div>
        </div>

        {/* End */}
        <EventDuration value={duration} onChange={next => {
          if (next === '' && duration !== '') {
            const range = eventFormRange({ startDate, startTime, endDate, endTime }, originalTimes.current ?? undefined, Number(duration))
            if (range) {
              const end = new Date(range.end)
              setEndDate(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
              setEndTime(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`)
            }
          }
          setDuration(next)
        }} end={duration === '' ? undefined : eventFormRange({ startDate, startTime, endDate, endTime }, originalTimes.current ?? undefined, Number(duration))?.end} />

        <div hidden={duration !== ''}>
          <label className="label-apple" htmlFor="endDate">{message('end')}</label>
          <div className="grid grid-cols-2 gap-3">
            <input
              id="endDate"
              disabled={duration !== ''}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-apple"
              min={startDate}
            />
            <input
              id="endTime"
              disabled={duration !== ''}
              aria-label={message('endTime')}
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="input-apple"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="label-apple" htmlFor="location">{message('location')}</label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="input-apple"
            placeholder={message('editLocationPlaceholder')}
          />
        </div>

        {/* Submit */}
        <div className={inSheet ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-3 pb-1" : "pt-2"}>
          <button
            type="submit"
            disabled={loading || !title || !startDate || originalTimes.current?.eventId !== eventId}
            className="btn-filled w-full"
          >
            {loading ? message('saving') : message('save')}
          </button>
        </div>
      </form>

      {isParent && (
        <div className="px-4 pt-4">
          <button
            type="button"
            disabled={deleting || originalTimes.current?.eventId !== eventId}
            onClick={() => {
              setDeleteError(null)
              setConfirmOpen(true)
            }}
            className="btn-plain w-full min-h-[44px] text-[var(--danger-text)]"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>{message('deleteEvent')}</span>
          </button>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onClose={deleting ? undefined : () => setConfirmOpen(false)}
        title={message('deleteTitle')}
        closeLabel={message('close')}
        description={message('deleteDescription', { title })}
        initialFocusRef={cancelRef}
        testId="delete-event-dialog"
      >
        {deleteError && (
          <p role="alert" className="mb-4 text-body text-[var(--danger-text)]">
            {'key' in deleteError ? message(deleteError.key) : deleteError.raw}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => setConfirmOpen(false)}
            disabled={deleting}
            className="btn-tinted min-h-[44px]"
          >
            {message('cancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || originalTimes.current?.eventId !== eventId}
            className="btn-destructive min-h-[44px]"
          >
            {deleting ? message('deleting') : message('delete')}
          </button>
        </div>
      </Dialog>
    </div>
  )
}

function CalendarLoading() {
  const { t } = useTranslation()
  const key: CalendarFormMessage = 'loading'
  return <div className="text-label-secondary">{t(key, undefined, calendarFormMessages)}</div>
}

export default function EditEventPage({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <CalendarLoading />
      </div>
    }>
      <EditEventForm inSheet={inSheet} onBusyChange={onBusyChange} />
    </Suspense>
  )
}
