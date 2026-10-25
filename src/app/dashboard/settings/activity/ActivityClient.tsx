'use client'

/**
 * Settings -> Recent changes (#285, PR101 D-4): the household audit history,
 * newest first, grouped by day, in plain words. Reads `GET /api/audit` a page
 * at a time ("Show older changes"). States: loading, nothing yet, could not
 * load (with Try again) and offline (nothing is sent). Every control is a
 * native link or button at least 44px tall.
 */
import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, History, TabletSmartphone, WifiOff } from 'lucide-react'
import { useOnline } from '@/components/ui/use-online'

export const ACTIVITY_PAGE_SIZE = 20

export interface ActivityEntry {
  id: string
  action: string
  actorKind: 'person' | 'device'
  actor: { id: string; name: string } | null
  summary: string
  createdAt: string
}

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; entries: ActivityEntry[]; nextCursor: string | null; more: 'idle' | 'loading' | 'error' }

const LOAD_ERROR = "Recent changes didn't load. Check your connection and try again."

function isActivityEntry(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const actor = row.actor as Record<string, unknown> | null
  return typeof row.id === 'string' && row.id.length > 0 &&
    typeof row.action === 'string' &&
    (row.actorKind === 'person' || row.actorKind === 'device') &&
    (actor === null || (typeof actor === 'object' &&
      typeof actor.id === 'string' && typeof actor.name === 'string')) &&
    typeof row.summary === 'string' && typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt))
}

/** Validate the canonical envelope; malformed data is not a truthful empty history. */
async function fetchPage(cursor: string | null, signal: AbortSignal): Promise<{ entries: ActivityEntry[]; nextCursor: string | null }> {
  if (signal.aborted) throw new Error('Activity read cancelled')
  const params = new URLSearchParams({ limit: String(ACTIVITY_PAGE_SIZE) })
  if (cursor) params.set('cursor', cursor)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  try {
    return await Promise.race([
      (async () => {
        const res = await fetch(`/api/audit?${params.toString()}`, {
          headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: unknown = await res.json()
        if (!body || typeof body !== 'object') throw new Error('Invalid activity page')
        const page = body as Record<string, unknown>
        if (!Array.isArray(page.entries) || page.entries.length > ACTIVITY_PAGE_SIZE ||
          !page.entries.every(isActivityEntry) ||
          new Set(page.entries.map((row) => row.id)).size !== page.entries.length ||
          !(page.nextCursor === null || (typeof page.nextCursor === 'string' &&
            page.nextCursor.length > 0 && page.nextCursor.length <= 200)) ||
          (page.nextCursor !== null && (page.nextCursor === cursor || page.entries.length === 0)))
          throw new Error('Invalid activity page')
        return { entries: page.entries as ActivityEntry[], nextCursor: page.nextCursor as string | null }
      })(),
      new Promise<never>((_, reject) => {
        abort = () => { controller.abort(); reject(new Error('Activity read cancelled')) }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        timer = setTimeout(() => { controller.abort(); reject(new Error('Activity read timed out')) }, 15000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(d: Date, now: Date): string {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(now)) return 'Today'
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function byWhom(entry: ActivityEntry): string {
  const who = entry.actor ? entry.actor.name : 'A former member'
  return entry.actorKind === 'device' ? `${who}, on the family tablet` : who
}

export default function ActivityClient() {
  const online = useOnline()
  const [status, setStatus] = React.useState<Status>({ kind: 'loading' })
  const [attempt, setAttempt] = React.useState(0)

  const generation = React.useRef(0)
  const pending = React.useRef(false)
  const olderRead = React.useRef<AbortController | null>(null)
  const usedCursors = React.useRef(new Set<string>())
  const onlineRef = React.useRef(online)
  onlineRef.current = online

  React.useEffect(() => {
    const epoch = ++generation.current
    olderRead.current?.abort()
    olderRead.current = null
    pending.current = false
    usedCursors.current.clear()
    const controller = new AbortController()
    if (online && navigator.onLine !== false) {
      setStatus({ kind: 'loading' })
      fetchPage(null, controller.signal)
        .then((page) => {
          if (epoch === generation.current && !controller.signal.aborted && onlineRef.current && navigator.onLine !== false)
            setStatus({ kind: 'ready', ...page, more: 'idle' })
        })
        .catch(() => {
          if (epoch === generation.current && !controller.signal.aborted)
            setStatus({ kind: 'error' })
        })
    }
    return () => {
      generation.current++
      controller.abort()
      olderRead.current?.abort()
    }
  }, [online, attempt])

  async function loadOlder() {
    if (!onlineRef.current || navigator.onLine === false || pending.current ||
      status.kind !== 'ready' || !status.nextCursor || status.more === 'loading') return
    const current = status
    const cursor = current.nextCursor!
    const epoch = generation.current
    const controller = new AbortController()
    olderRead.current = controller
    pending.current = true
    setStatus({ ...current, more: 'loading' })
    try {
      const page = await fetchPage(cursor, controller.signal)
      if (epoch !== generation.current || controller.signal.aborted || !onlineRef.current) return
      if (page.nextCursor && usedCursors.current.has(page.nextCursor)) throw new Error('Activity cursor loop')
      usedCursors.current.add(cursor)
      const known = new Set(current.entries.map((entry) => entry.id))
      setStatus({
        kind: 'ready',
        entries: [...current.entries, ...page.entries.filter((entry) => !known.has(entry.id))],
        nextCursor: page.nextCursor,
        more: 'idle',
      })
    } catch {
      if (epoch === generation.current && !controller.signal.aborted && onlineRef.current)
        setStatus({ ...current, more: 'error' })
    } finally {
      if (epoch === generation.current && olderRead.current === controller) {
        olderRead.current = null
        pending.current = false
      }
    }
  }

  const now = new Date()
  const groups: Array<{ key: string; label: string; entries: ActivityEntry[] }> = []
  if (status.kind === 'ready') {
    for (const entry of status.entries) {
      const at = new Date(entry.createdAt)
      const key = dayKey(at)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.entries.push(entry)
      else groups.push({ key, label: dayLabel(at, now), entries: [entry] })
    }
  }

  let announcement = ''
  if (!online) announcement = "You're offline. Recent changes need a connection."
  else if (status.kind === 'loading') announcement = 'Loading recent changes…'
  else if (status.kind === 'ready' && status.more === 'loading') announcement = 'Loading older changes…'
  else if (status.kind === 'ready') {
    announcement = status.entries.length === 0 ? 'No changes yet.' : `${status.entries.length} changes shown.`
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 min-h-[44px] -ml-2 px-2 rounded-lg text-subhead text-label-secondary focus-visible:shadow-[var(--shadow-focus)]"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Settings
        </Link>
        <h1 className="text-large-title font-display">Recent changes</h1>
        <p className="text-subhead text-label-secondary mt-0.5">
          Who changed household settings, and when: features, invites, new members, the Today board and family tablets.
          Only parents can see this. Changes are kept for 12 months.
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!online && (
        <div className="card-apple p-6 text-center flex flex-col items-center gap-2" data-testid="activity-offline">
          <WifiOff className="w-6 h-6 text-label-tertiary" aria-hidden="true" />
          <p className="text-subhead text-label-secondary">You&apos;re offline. Recent changes need a connection.</p>
        </div>
      )}

      {online && status.kind === 'loading' && (
        <div className="space-y-2" data-testid="activity-loading" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-[var(--radius-md)] bg-[var(--surface-fill)] animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {online && status.kind === 'error' && (
        <div className="card-apple p-6 text-center flex flex-col items-center gap-3" data-testid="activity-error">
          <p className="text-subhead text-label-secondary" role="alert">
            {LOAD_ERROR}
          </p>
          <button type="button" className="btn-tinted min-h-[44px]" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {online && status.kind === 'ready' && status.entries.length === 0 && (
        <div className="card-apple p-8 text-center flex flex-col items-center" data-testid="activity-empty">
          <div className="w-16 h-16 rounded-full bg-[var(--surface-fill)] flex items-center justify-center mb-4">
            <History className="w-7 h-7 text-label-tertiary" aria-hidden="true" />
          </div>
          <h2 className="text-title-3 text-label-primary mb-1">No changes yet</h2>
          <p className="text-subhead text-label-secondary max-w-xs">
            When a parent turns a feature on or off, sends an invite or sets up a tablet, it shows up here.
          </p>
        </div>
      )}

      {online && status.kind === 'ready' && status.entries.length > 0 && (
        <div className="space-y-5" data-testid="activity-list">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`activity-day-${group.key}`}>
              <h2 id={`activity-day-${group.key}`} className="section-header px-1 pb-1">
                {group.label}
              </h2>
              <ul className="list-inset">
                {group.entries.map((entry) => {
                  const at = new Date(entry.createdAt)
                  return (
                    <li
                      key={entry.id}
                      className="row-apple border-b border-[var(--surface-separator)] last:border-b-0"
                      data-testid="activity-entry"
                      data-entry-id={entry.id}
                    >
                      {entry.actorKind === 'device' && (
                        <TabletSmartphone className="w-4 h-4 text-label-tertiary shrink-0" aria-hidden="true" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-body text-label-primary break-words">{entry.summary}</span>
                        <span className="block text-footnote text-label-secondary break-words">
                          {byWhom(entry)} ·{' '}
                          <time dateTime={entry.createdAt}>
                            {at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          </time>
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          {status.more === 'error' && (
            <p className="text-subhead text-label-secondary text-center" role="alert">
              Older changes didn&apos;t load. Try again.
            </p>
          )}
          {status.nextCursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                onClick={loadOlder}
                disabled={status.more === 'loading'}
                aria-busy={status.more === 'loading'}
              >
                {status.more === 'loading' ? 'Loading…' : 'Show older changes'}
              </button>
            </div>
          ) : (
            <p className="text-footnote text-label-tertiary text-center">That&apos;s everything from the last 12 months.</p>
          )}
        </div>
      )}
    </div>
  )
}
