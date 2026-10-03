'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'

function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/**
 * "Send to Calendar": adds the project's incomplete, dated tasks to the
 * household calendar as all-day events on their due day (in the viewer's
 * time zone). Tasks already sent are skipped by the API.
 */
export function SendToCalendarButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/send-to-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone: viewerTimeZone() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error((data && typeof data.error === 'string' && data.error) || 'Please try again.')
      }
      const created = typeof data?.eventsCreated === 'number' ? data.eventsCreated : 0
      addToast({
        type: 'success',
        title:
          created > 0
            ? `Added ${created} ${created === 1 ? 'task' : 'tasks'} to the calendar`
            : 'Nothing new to add',
        message: created > 0 ? undefined : 'Dated tasks are already on the calendar.',
      })
      router.refresh()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Could not send to calendar',
        message: error instanceof TypeError ? 'Check your connection and try again.' : error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={sending}
      aria-busy={sending || undefined}
      className="btn-tinted bg-tint-projects text-white min-h-[44px] px-4 py-2 text-sm font-medium shrink-0 disabled:opacity-60"
    >
      {sending ? 'Sending…' : 'Send to Calendar'}
    </button>
  )
}
