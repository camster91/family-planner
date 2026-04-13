'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Calendar as CalendarIcon } from 'lucide-react'
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
  const [eventType, setEventType] = useState('other')
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
            setEventType(event.event_type || 'other')
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
          event_type: eventType,
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
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading event data...</p>
      </div>
    )
  }

  if (!eventId) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">No Event Selected</h2>
          <p className="text-gray-600 mb-6">Please select an event to edit.</p>
          <Link href="/dashboard/calendar" className="btn-primary">Back to Calendar</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/dashboard/calendar"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Calendar
      </Link>

      <div className="card">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <CalendarIcon className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Event</h1>
          <p className="mt-2 text-gray-600">Update your event details below.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">{error}</div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">Event Title *</label>
            <input id="title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="e.g., Soccer practice, Family dinner" />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">Description (Optional)</label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="input-field min-h-[100px]" placeholder="Add details..." rows={3} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">Start Date *</label>
              <input id="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label htmlFor="startTime" className="block text-sm font-medium text-gray-700 mb-2">Start Time (Optional)</label>
              <input id="startTime" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-2">End Date (Optional)</label>
              <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" min={startDate} />
            </div>
            <div>
              <label htmlFor="endTime" className="block text-sm font-medium text-gray-700 mb-2">End Time (Optional)</label>
              <input id="endTime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input-field" />
            </div>
          </div>

          <div>
            <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">Location (Optional)</label>
            <input id="location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="input-field" placeholder="e.g., Home, School" />
          </div>

          <div>
            <label htmlFor="eventType" className="block text-sm font-medium text-gray-700 mb-2">Event Type</label>
            <select id="eventType" value={eventType} onChange={(e) => setEventType(e.target.value)} className="input-field">
              <option value="school">School</option>
              <option value="sports">Sports</option>
              <option value="appointment">Appointment</option>
              <option value="family">Family</option>
              <option value="work">Work</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-6 border-t">
            <Link href="/dashboard/calendar" className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={loading || !title || !startDate} className="btn-primary">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function EditEventPage() {
  return (
    <Suspense fallback={<div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div><p className="mt-4 text-gray-600">Loading...</p></div>}>
      <EditEventForm />
    </Suspense>
  )
}