'use client'

// Per-member notification switches (#286, PR101 D-5). Used by the Settings
// "Notifications" section (parents) and by the user-menu dialog (teens and
// children, who cannot open Settings; src/lib/kid-access.ts).
//
// Each switch saves on its own: the change shows at once, and goes back with a
// message if the save fails. Offline, the switches are disabled with a notice.
//
// Quiet hours (#141, O-32): a switch plus "From"/"Until" times. Notifications
// still arrive in the list during quiet hours; they just must not interrupt.
// The times are saved with this browser's time zone (O-31: dates use the
// browser's local time).

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
import { isClockTime } from '@/lib/ambient'
import { DEFAULT_QUIET_HOURS, quietHoursProblem, type QuietHours } from '@/lib/quiet-hours'

const ENDPOINT = '/api/users/preferences'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; prefs: Prefs; quiet: QuietHours }

function isPrefs(value: unknown): value is Prefs {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return NOTIFICATION_CATEGORIES.every((c) => typeof v[c] === 'boolean')
}

function isQuietHours(value: unknown): value is QuietHours {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.enabled === 'boolean' &&
    isClockTime(v.start) &&
    isClockTime(v.end) &&
    (v.timeZone === null || typeof v.timeZone === 'string')
  )
}

/** This browser's IANA time zone, or null when the browser does not say. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export default function NotificationPreferences({ className }: { className?: string }) {
  const online = useOnline()
  const [load, setLoad] = React.useState<Load>({ state: 'loading' })
  const [saving, setSaving] = React.useState<Partial<Record<NotificationCategory, boolean>>>({})
  const [status, setStatus] = React.useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const [quietDraft, setQuietDraft] = React.useState({ start: DEFAULT_QUIET_HOURS.start, end: DEFAULT_QUIET_HOURS.end })
  const [quietSaving, setQuietSaving] = React.useState(false)
  const [quietError, setQuietError] = React.useState<string | null>(null)
  const [timeZone, setTimeZone] = React.useState<string | null>(null)
  const idBase = React.useId()

  // Read after mount so the server render and the first client render match.
  React.useEffect(() => {
    setTimeZone(browserTimeZone())
  }, [])

  const fetchPrefs = React.useCallback(async () => {
    setLoad({ state: 'loading' })
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      const body = res.ok ? await res.json() : null
      if (!isPrefs(body?.preferences)) throw new Error('bad response')
      const quiet = isQuietHours(body?.quietHours) ? body.quietHours : DEFAULT_QUIET_HOURS
      setLoad({ state: 'ready', prefs: body.preferences, quiet })
      setQuietDraft({ start: quiet.start, end: quiet.end })
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
    setLoad((l) => (l.state === 'ready' ? { ...l, prefs: { ...l.prefs, [category]: next } } : l))
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
      setLoad((l) => (l.state === 'ready' ? { ...l, prefs: { ...l.prefs, [category]: saved } } : l))
      setStatus({ kind: 'saved', text: `${CATEGORY_COPY[category].label}: ${saved ? 'on' : 'off'}.` })
    } catch {
      setLoad((l) => (l.state === 'ready' ? { ...l, prefs: { ...l.prefs, [category]: previous } } : l))
      setStatus({
        kind: 'error',
        text: `Couldn't save "${CATEGORY_COPY[category].label}". It is back to ${previous ? 'on' : 'off'}. Try again.`,
      })
    } finally {
      setSaving((s) => ({ ...s, [category]: false }))
    }
  }

  // Saves the whole quiet-hours setting: `enabled` plus the times in the
  // boxes, in this browser's time zone. Goes back with a message on failure.
  const saveQuiet = async (enabled: boolean) => {
    if (load.state !== 'ready' || quietSaving || !online) return
    const problem = quietHoursProblem(quietDraft.start, quietDraft.end)
    if (problem) {
      setQuietError(problem)
      return
    }
    setQuietError(null)
    const previous = load.quiet
    const next: QuietHours = { enabled, start: quietDraft.start, end: quietDraft.end, timeZone: browserTimeZone() }
    setLoad((l) => (l.state === 'ready' ? { ...l, quiet: next } : l))
    setQuietSaving(true)
    setStatus(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: newIdempotencyKey() },
        body: JSON.stringify({ quietHours: next }),
      })
      const body = res.ok ? await res.json() : null
      if (!isQuietHours(body?.quietHours)) throw new Error('save failed')
      const saved: QuietHours = body.quietHours
      setLoad((l) => (l.state === 'ready' ? { ...l, quiet: saved } : l))
      setQuietDraft({ start: saved.start, end: saved.end })
      setStatus({
        kind: 'saved',
        text: saved.enabled ? `Quiet hours: on, ${saved.start} to ${saved.end}.` : 'Quiet hours: off.',
      })
    } catch {
      setLoad((l) => (l.state === 'ready' ? { ...l, quiet: previous } : l))
      setStatus({
        kind: 'error',
        text: `Couldn't save quiet hours. They are back to ${previous.enabled ? 'on' : 'off'}. Try again.`,
      })
    } finally {
      setQuietSaving(false)
    }
  }

  const quietDirty =
    load.state === 'ready' && (quietDraft.start !== load.quiet.start || quietDraft.end !== load.quiet.end)

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

      {load.state === 'ready' && (
        <fieldset className="mt-2 border-t border-[var(--surface-separator)] pt-3" data-testid="quiet-hours">
          <legend className="sr-only">Quiet hours</legend>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={`${idBase}-quiet-label`} className="text-[16px] font-medium text-label-primary">
                Quiet hours
              </p>
              <p id={`${idBase}-quiet-desc`} className="text-[14px] leading-snug text-label-secondary">
                Notifications still arrive in your list, but nothing should interrupt you between these times.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={load.quiet.enabled}
              aria-labelledby={`${idBase}-quiet-label`}
              aria-describedby={`${idBase}-quiet-desc`}
              aria-busy={quietSaving ? true : undefined}
              disabled={!online || quietSaving}
              onClick={() => void saveQuiet(!load.quiet.enabled)}
              className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
            >
              <span className="w-7 text-right text-[14px] font-medium text-label-secondary" aria-hidden="true">
                {load.quiet.enabled ? 'On' : 'Off'}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none',
                  load.quiet.enabled ? 'bg-accent-fill' : 'bg-[var(--label-tertiary)]'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
                    load.quiet.enabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </span>
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            {(['start', 'end'] as const).map((edge) => (
              <label key={edge} className="flex flex-col text-[14px] text-label-secondary">
                {edge === 'start' ? 'Quiet from' : 'Quiet until'}
                <input
                  type="time"
                  value={quietDraft[edge]}
                  required
                  disabled={!online || quietSaving}
                  aria-invalid={quietError ? true : undefined}
                  aria-describedby={quietError ? `${idBase}-quiet-error` : `${idBase}-quiet-zone`}
                  onChange={(e) => {
                    setQuietError(null)
                    setQuietDraft((d) => ({ ...d, [edge]: e.target.value }))
                  }}
                  className="mt-1 min-h-[44px] rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-3 text-[16px] text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
                />
              </label>
            ))}
            <button
              type="button"
              disabled={!online || quietSaving || !quietDirty}
              onClick={() => void saveQuiet(load.quiet.enabled)}
              className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
            >
              Save times
            </button>
          </div>
          {quietError ? (
            <p id={`${idBase}-quiet-error`} role="alert" className="pt-2 text-[14px] text-red-700 dark:text-red-400">
              {quietError}
            </p>
          ) : (
            <p id={`${idBase}-quiet-zone`} className="pt-2 text-[14px] leading-snug text-label-secondary">
              Times use this device&apos;s clock{timeZone ? ` (${timeZone})` : ''}. An end time earlier than the start
              runs past midnight.
            </p>
          )}
        </fieldset>
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
