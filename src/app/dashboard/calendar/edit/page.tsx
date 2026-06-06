'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'

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
  const router = useRouter()
  const searchParams = useSearchParams()
  const eventId = searchParams.get('id')

  useEffect(() => {
    if (!eventId) {
      setError('No event ID provided')
      setFetching(false)
      return
    }

    const fetchEvent = async () => {
      try {
        const res = await fetch('/api/events')
        if (res.ok) {
          const data = await res.json()
          const event = data.events?.find((e: any) => e.id === eventId)
          if (event) {
            setTitle(event.title)
            setDescription(event.description || '')
            const start = new Date(event.start_time)
            setStartDate(start.toISOString().split('T')[0])
            setStartTime(start.toISOString().split('T')[1]?.substring(0, 5) || '')
            if (event.end_time) {
              const end = new Date(event.end_time)
              setEndDate(end.toISOString().split('T')[0])
              setEndTime(end.toISOString().split('T')[1]?.substring(0, 5) || '')
            }
            setLocation(event.location || '')
          } else {
            setError('Event not found')
          }
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
      const startDateTime = `${startDate}T${startTime || '00:00'}`
      const endDateTime = endDate ? `${endDate}T${endTime || '23:59'}` : startDateTime

      if (new Date(endDateTime) < new Date(startDateTime)) {
        setError('End date/time must be after start date/time')
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
            <p className="text-body text-[var(--danger)]">{error}</p>
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