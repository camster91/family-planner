'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils'

interface EventCardProps {
  event: {
    id: string
    title: string
    description?: string | null
    start_time: string | Date
    end_time?: string | Date | null
    location?: string | null
    event_type: string
    creator?: { name: string } | null
  }
  userRole: string
}

export default function EventCard({ event, userRole }: EventCardProps) {
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this event?')) return

    setDeleting(true)
    try {
      const res = await fetch('/api/events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete event')
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete event')
    } finally {
      setDeleting(false)
    }
  }

  const startTime = new Date(event.start_time)
  const endTime = event.end_time ? new Date(event.end_time) : null

  return (
    <div className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition group">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-medium text-gray-900">{event.title}</h4>
          {event.description && (
            <p className="text-sm text-gray-600 mt-1">{event.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-500">
            <div>
              🕒 {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {endTime && (
                <> - {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
              )}
            </div>
            {event.location && (
              <div>📍 {event.location}</div>
            )}
            {event.creator && (
              <div>👤 Created by {event.creator.name}</div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {userRole === 'parent' && (
            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => router.push(`/dashboard/calendar/edit?id=${event.id}`)}
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Edit event"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete event"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
            {event.event_type === 'other' ? 'Event' : event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1)}
          </span>
        </div>
      </div>
    </div>
  )
}