'use client'

// Beta usage counts switch (#287, PR101 D-6). Settings -> Privacy & Security,
// parents only (the page decides; PATCH /api/family/beta-metrics refuses
// everyone else too). Saves on its own like the notification switches: the
// change shows at once and goes back with a message if the save fails;
// offline, the switch is disabled with a notice.

import * as React from 'react'
import Link from 'next/link'
import { useOnline } from '@/components/ui/use-online'
import { cn } from '@/lib/utils'

const ENDPOINT = '/api/family/beta-metrics'
const LABEL = 'Share beta usage counts'

export default function BetaMetricsSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const online = useOnline()
  const [on, setOn] = React.useState(initialEnabled)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const idBase = React.useId()
  const labelId = `${idBase}-label`
  const descId = `${idBase}-desc`

  const toggle = async () => {
    if (saving || !online) return
    const previous = on
    const next = !previous
    setOn(next)
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const body = res.ok ? await res.json() : null
      const saved = body?.betaMetrics?.enabled
      if (typeof saved !== 'boolean') throw new Error('save failed')
      setOn(saved)
      setStatus({
        kind: 'saved',
        text: saved ? 'Beta usage counts: on.' : 'Beta usage counts: off. The stored counts were deleted.',
      })
    } catch {
      setOn(previous)
      setStatus({ kind: 'error', text: `Couldn't save. It is back to ${previous ? 'on' : 'off'}. Try again.` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg p-3" data-testid="beta-metrics-switch">
      {!online && (
        <p
          role="status"
          className="mb-3 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-3 py-2 text-[15px] text-label-primary"
        >
          You&apos;re offline. You can change this again when you&apos;re back online.
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="font-medium text-gray-700">
            {LABEL}
          </p>
          <p id={descId} className="text-xs text-gray-500">
            Helps us check the beta works. Each day we count how many events and meals your household adds, chores
            it assigns, completes and checks, rewards claimed and members who joined. Only numbers: no names,
            messages or other content. Off unless a parent turns it on; turning it off deletes the counts.{' '}
            <Link href="/privacy#beta-usage-counts" className="text-blue-600 underline">
              What is counted
            </Link>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={descId}
          aria-busy={saving ? true : undefined}
          disabled={!online || saving}
          onClick={() => void toggle()}
          className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
        >
          {/* The word says the state; colour is not the only cue. */}
          <span className="w-7 text-right text-[14px] font-medium text-label-secondary" aria-hidden="true">
            {on ? 'On' : 'Off'}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none',
              on ? 'bg-accent-fill' : 'bg-[var(--label-tertiary)]'
            )}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
                on ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </span>
        </button>
      </div>
      <p aria-live="polite" className="min-h-[1.5em] pt-2 text-[14px]">
        {status && (
          <span className={status.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-label-secondary'}>
            {status.text}
          </span>
        )}
      </p>
    </div>
  )
}
