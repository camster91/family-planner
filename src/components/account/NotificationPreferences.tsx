'use client'

// Per-member notification switches (#286, PR101 D-5). Used by the Settings
// "Notifications" section (parents) and by the user-menu dialog (teens and
// children, who cannot open Settings; src/lib/kid-access.ts).
//
// Each switch saves on its own: the change shows at once, and goes back with a
// message if the save fails. Offline, the switches are disabled with a notice.

import * as React from 'react'
import { newIdempotencyKey, IDEMPOTENCY_HEADER } from '@/lib/idempotency-key'
import { useOnline } from '@/components/ui/use-online'
import { cn } from '@/lib/utils'
import {
  CATEGORY_COPY,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences as Prefs,
} from '@/lib/notification-policy'

const ENDPOINT = '/api/users/preferences'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; prefs: Prefs }

function isPrefs(value: unknown): value is Prefs {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return NOTIFICATION_CATEGORIES.every((c) => typeof v[c] === 'boolean')
}

export default function NotificationPreferences({ className }: { className?: string }) {
  const online = useOnline()
  const [load, setLoad] = React.useState<Load>({ state: 'loading' })
  const [saving, setSaving] = React.useState<Partial<Record<NotificationCategory, boolean>>>({})
  const [status, setStatus] = React.useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const idBase = React.useId()

  const fetchPrefs = React.useCallback(async () => {
    setLoad({ state: 'loading' })
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      const body = res.ok ? await res.json() : null
      if (!isPrefs(body?.preferences)) throw new Error('bad response')
      setLoad({ state: 'ready', prefs: body.preferences })
    } catch {
      setLoad({ state: 'error' })
    }
  }, [])

  React.useEffect(() => {
    void fetchPrefs()
  }, [fetchPrefs])

  const toggle = async (category: NotificationCategory) => {
    if (load.state !== 'ready' || saving[category] || !online) return
    const previous = load.prefs[category]
    const next = !previous
    // Optimistic: flip now, put it back if the save fails.
    setLoad((l) => (l.state === 'ready' ? { state: 'ready', prefs: { ...l.prefs, [category]: next } } : l))
    setSaving((s) => ({ ...s, [category]: true }))
    setStatus(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: newIdempotencyKey() },
        body: JSON.stringify({ [category]: next }),
      })
      const body = res.ok ? await res.json() : null
      if (!isPrefs(body?.preferences)) throw new Error('save failed')
      // Take only this switch from the answer, so a save still running for
      // another switch is not overwritten by this response.
      const saved = body.preferences[category]
      setLoad((l) => (l.state === 'ready' ? { state: 'ready', prefs: { ...l.prefs, [category]: saved } } : l))
      setStatus({ kind: 'saved', text: `${CATEGORY_COPY[category].label}: ${saved ? 'on' : 'off'}.` })
    } catch {
      setLoad((l) => (l.state === 'ready' ? { state: 'ready', prefs: { ...l.prefs, [category]: previous } } : l))
      setStatus({
        kind: 'error',
        text: `Couldn't save "${CATEGORY_COPY[category].label}". It is back to ${previous ? 'on' : 'off'}. Try again.`,
      })
    } finally {
      setSaving((s) => ({ ...s, [category]: false }))
    }
  }

  return (
    <div className={className} data-testid="notification-preferences">
      {!online && (
        <p
          role="status"
          className="mb-3 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-3 py-2 text-[15px] text-label-primary"
        >
          You&apos;re offline. You can change these again when you&apos;re back online.
        </p>
      )}

      {load.state === 'loading' && (
        <p className="py-3 text-[15px] text-label-secondary" role="status">
          Loading your notification settings…
        </p>
      )}

      {load.state === 'error' && (
        <div className="py-2">
          <p role="alert" className="text-[15px] text-label-primary">
            Couldn&apos;t load your notification settings.
          </p>
          <button
            type="button"
            onClick={() => void fetchPrefs()}
            className="mt-2 inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
          >
            Try again
          </button>
        </div>
      )}

      {load.state === 'ready' && (
        <ul className="divide-y divide-[var(--surface-separator)]">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const on = load.prefs[category]
            const labelId = `${idBase}-${category}-label`
            const descId = `${idBase}-${category}-desc`
            return (
              <li key={category} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p id={labelId} className="text-[16px] font-medium text-label-primary">
                    {CATEGORY_COPY[category].label}
                  </p>
                  <p id={descId} className="text-[14px] leading-snug text-label-secondary">
                    {CATEGORY_COPY[category].description}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={labelId}
                  aria-describedby={descId}
                  aria-busy={saving[category] ? true : undefined}
                  disabled={!online || saving[category]}
                  onClick={() => void toggle(category)}
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
              </li>
            )
          })}
        </ul>
      )}

      <p aria-live="polite" className="min-h-[1.5em] pt-2 text-[14px]">
        {status && (
          <span className={status.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-label-secondary'}>
            {status.text}
          </span>
        )}
      </p>

      <p className="text-[14px] leading-snug text-label-secondary">
        Some messages always arrive: password resets, email checks, household invites, and notices a parent sends
        you.
      </p>
    </div>
  )
}
