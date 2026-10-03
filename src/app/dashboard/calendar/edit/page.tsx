'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { format } from 'date-fns'
import { eventFormRange } from '@/lib/dates'
import { Dialog } from '@/components/ui/dialog'

function EditEventForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Imported events (#232) are read-only; the API refuses edits with 409.
  const [source, setSource] = useState<{ name: string } | null>(null)
  // DELETE /api/events is parent-only (like PATCH). Unknown until
  // /api/auth/me answers, so Delete never flashes for a teen or child.
  const [isParent, setIsParent] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const eventId = searchParams.get('id')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsParent(d?.user?.role === 'parent'))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!eventId) {
      setError('No event ID provided')
      setFetching(false)
      return
    }

    const fetchEvent = async () => {
      try {
        const res = await fetch(`/api/events?id=${encodeURIComponent(eventId)}`)
        if (res.ok) {
          const data = await res.json()
          const event = data.event
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
          setError('Event not found')
        } else {
          setError('Failed to load event data')
        }
      } catch (err) {
        console.error('Error fetching event:', err)
        setError('Failed to load event data')
      } finally {
        setFetching(false)
      }
    }

    fetchEvent()
  }, [eventId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!eventId) return

    setLoading(true)
    setError(null)

    try {
      // Form values are local wall-clock time; send real ISO instants (with offset)
      // An end time without an end date is on the start day (src/lib/dates.ts).
      const range = eventFormRange({ startDate, startTime, endDate, endTime })
      const startDateTime = range?.start
      const endDateTime = range?.end

      if (!startDateTime || !endDateTime) {
        setError('Invalid date/time')
        setLoading(false)
        return
      }

      if (new Date(endDateTime) < new Date(startDateTime)) {
        setError('The end must be after the start. Check the end date and time.')
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
        setError(data.error || 'Failed to update event')
        return
      }

      router.push('/dashboard/calendar')
      router.refresh()
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!eventId) return
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
        setDeleteError(typeof data?.error === 'string' ? data.error : 'Could not delete the event. Try again.')
        return
      }
      setConfirmOpen(false)
      router.push('/dashboard/calendar')
      router.refresh()
    } catch {
      setDeleteError('Could not delete the event. Check your connection and try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (fetching) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-label-secondary">Loading...</div>
      </div>
    )
  }

  if (!eventId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <div className="card-apple p-8">
          <h2 className="text-title-2 text-label-primary mb-2">No Event Selected</h2>
          <p className="text-body text-label-secondary mb-6">Please select an event to edit.</p>
          <Link href="/dashboard/calendar" className="btn-filled">Back to Calendar</Link>
        </div>
      </div>
    )
  }

  if (source) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="card-apple p-8">
          <h1 className="text-title-2 text-label-primary mb-2">{title}</h1>
          <p className="text-body text-label-secondary mb-2">From {source.name}</p>
          <p className="text-body text-label-secondary mb-6">
            This event comes from a subscribed calendar, so it is read-only here. Change it in the original
            calendar and it will update on the next refresh.
          </p>
          <Link href="/dashboard/calendar" className="btn-filled">Back to Calendar</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto pb-20">
      {/* Back nav */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/calendar" className="btn-plain text-base py-2">
          <ArrowLeft className="w-5 h-5" />
          <span>Calendar</span>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-large-title font-display">Edit Event</h1>
        <p className="text-subhead text-label-secondary mt-1">Update the event details.</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 px-4">

        {error && (
          <div className="card-apple p-4 border border-[var(--danger)]">
            <p className="text-body text-[var(--danger-text)]">{error}</p>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="label-apple" htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-apple"
            placeholder="e.g., Soccer practice, Family dinner"
          />
        </div>

        {/* Description */}
        <div>
          <label className="label-apple" htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-apple min-h-[80px] resize-none"
            placeholder="Add details..."
            rows={3}
          />
        </div>

        {/* Start */}
        <div>
          <label className="label-apple" htmlFor="startDate">Start</label>
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
              aria-label="Start time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="input-apple"
            />
          </div>
        </div>

        {/* End */}
        <div>
          <label className="label-apple" htmlFor="endDate">End</label>
          <div className="grid grid-cols-2 gap-3">
            <input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-apple"
              min={startDate}
            />
            <input
              id="endTime"
              aria-label="End time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="input-apple"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="label-apple" htmlFor="location">Location</label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="input-apple"
            placeholder="e.g., Home, School"
          />
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={loading || !title || !startDate}
            className="btn-filled w-full"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {isParent && (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => {
              setDeleteError(null)
              setConfirmOpen(true)
            }}
            className="btn-plain w-full min-h-[44px] text-[var(--danger-text)]"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>Delete event</span>
          </button>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onClose={deleting ? undefined : () => setConfirmOpen(false)}
        title="Delete this event?"
        description={`“${title}” will be removed from the family calendar for everyone.`}
        initialFocusRef={cancelRef}
        testId="delete-event-dialog"
      >
        {deleteError && (
          <p role="alert" className="mb-4 text-body text-[var(--danger-text)]">
            {deleteError}
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
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="btn-destructive min-h-[44px]"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Dialog>
    </div>
  )
}

export default function EditEventPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="text-label-secondary">Loading...</div>
      </div>
    }>
      <EditEventForm />
    </Suspense>
  )
}
