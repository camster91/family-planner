'use client'

import * as React from 'react'
import { Plane, MapPin, Calendar } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { LargeHeader } from '@/components/ui/large-header'
import { cn } from '@/lib/utils'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { useToast } from '@/components/ui/toast'
import { formatDateOnly, parseDateOnly, toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { useTravelText, type TravelMessage } from '@/i18n/travel'

interface TravelState {
  travel_mode_active: boolean
  travel_start_date: string | null
  travel_end_date: string | null
  travel_destination: string | null
}

interface Chore {
  id: string
  title: string
  due_date: string
  status: string
  assignee: { name: string } | null
}

const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTravelDate(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string') return false
  if (parseDateOnly(value)) return true
  return ISO_DATE_TIME_RE.test(value) && Boolean(parseDateOnly(value.slice(0, 10))) && !Number.isNaN(new Date(value).getTime())
}

function parseTravelState(value: unknown): TravelState | null {
  if (!isRecord(value)) return null
  if (
    typeof value.travel_mode_active !== 'boolean' ||
    !isTravelDate(value.travel_start_date) ||
    !isTravelDate(value.travel_end_date) ||
    (value.travel_destination !== null && typeof value.travel_destination !== 'string')
  ) {
    return null
  }
  return {
    travel_mode_active: value.travel_mode_active,
    travel_start_date: value.travel_start_date,
    travel_end_date: value.travel_end_date,
    travel_destination: value.travel_destination,
  }
}

function parseChore(value: unknown): Chore | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.due_date !== 'string' ||
    !isTravelDate(value.due_date)
  ) {
    return null
  }
  const assignee = value.assignee
  if (assignee !== null && (!isRecord(assignee) || typeof assignee.name !== 'string')) return null
  return {
    id: value.id,
    title: value.title,
    due_date: value.due_date,
    status: value.status,
    assignee: assignee as { name: string } | null,
  }
}

function parseChoreList(value: unknown): Chore[] | null {
  if (!isRecord(value) || !Array.isArray(value.chores)) return null
  const chores = value.chores.map(parseChore)
  return chores.every((chore): chore is Chore => chore !== null) ? chores : null
}

export default function TravelPage() {
  return (
    <FeatureGate featureKey="travel">
      <TravelPageInner />
    </FeatureGate>
  )
}

function TravelPageInner() {
  const text = useTravelText()
  const displayLocale = useDisplayLocale()
  const [travel, setTravel] = React.useState<TravelState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [destination, setDestination] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [pendingChores, setPendingChores] = React.useState<Chore[]>([])
  const [choresLoading, setChoresLoading] = React.useState(false)
  const [choresError, setChoresError] = React.useState(false)
  const mutationRef = React.useRef(false)
  const travelRequestRef = React.useRef(0)
  const choresRequestRef = React.useRef(0)

  const { addToast } = useToast()
  const notifyFailure = React.useCallback(
    (title: TravelMessage) => {
      addToast({ type: 'error', title: text(title), message: text('networkError') })
    },
    [addToast, text]
  )

  const fetchTravel = React.useCallback(async () => {
    const requestId = ++travelRequestRef.current
    setLoading(true)
    try {
      const res = await fetch('/api/family/travel')
      if (res.ok) {
        const data = await res.json()
        if (requestId !== travelRequestRef.current) return
        const parsed = parseTravelState(data)
        if (!parsed) {
          setLoadError(true)
          return
        }
        setTravel(parsed)
        setLoadError(false)
        setDestination(parsed.travel_destination ?? '')
        setStartDate(parsed.travel_start_date ? toDateOnlyUTC(parsed.travel_start_date) : '')
        setEndDate(parsed.travel_end_date ? toDateOnlyUTC(parsed.travel_end_date) : '')
      } else {
        if (requestId === travelRequestRef.current) setLoadError(true)
      }
    } catch {
      if (requestId === travelRequestRef.current) setLoadError(true)
    } finally {
      if (requestId === travelRequestRef.current) setLoading(false)
    }
  }, [])

  // Only the trip's chores: the due-date window, not every household chore.
  const tripStart = travel?.travel_mode_active ? travel.travel_start_date : null
  const tripEnd = travel?.travel_mode_active ? travel.travel_end_date : null
  const fetchChores = React.useCallback(async () => {
    const requestId = ++choresRequestRef.current
    if (!tripStart || !tripEnd) {
      setPendingChores([])
      setChoresError(false)
      setChoresLoading(false)
      return
    }
    setChoresLoading(true)
    setChoresError(false)
    try {
      const range = new URLSearchParams({ from: toDateOnlyUTC(tripStart), to: toDateOnlyUTC(tripEnd) })
      const res = await fetch(`/api/chores?${range}`)
      if (!res.ok) throw new Error('travel chores load failed')
      const data = await res.json()
      const parsed = parseChoreList(data)
      if (!parsed) throw new Error('travel chores response malformed')
      if (requestId === choresRequestRef.current) setPendingChores(parsed)
    } catch {
      if (requestId === choresRequestRef.current) setChoresError(true)
    } finally {
      if (requestId === choresRequestRef.current) setChoresLoading(false)
    }
  }, [tripStart, tripEnd])

  React.useEffect(() => {
    fetchTravel()
  }, [fetchTravel])

  React.useEffect(() => {
    fetchChores()
  }, [fetchChores])

  const handleToggle = async () => {
    if (!travel || loading || loadError || mutationRef.current) return
    mutationRef.current = true
    setSaving(true)
    try {
      const res = await fetch('/api/family/travel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Trip dates are date-only `YYYY-MM-DD` values; with no start date the
        // trip starts on the viewer's local today (O-31), not the UTC instant.
        body: JSON.stringify({
          travel_mode_active: !travel.travel_mode_active,
          travel_start_date: travel.travel_mode_active ? null : startDate || toDateOnlyLocal(new Date()),
          travel_end_date: travel.travel_mode_active ? null : endDate || null,
          travel_destination: travel.travel_mode_active ? null : destination,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const parsed = parseTravelState(data)
        if (parsed) {
          setTravel(parsed)
        } else {
          notifyFailure('toggleFailed')
        }
      } else {
        notifyFailure('toggleFailed')
      }
    } catch {
      notifyFailure('toggleFailed')
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const handleSaveDetails = async () => {
    if (!travel || loading || loadError || mutationRef.current) return
    mutationRef.current = true
    setSaving(true)
    try {
      const res = await fetch('/api/family/travel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          travel_start_date: startDate || null,
          travel_end_date: endDate || null,
          travel_destination: destination,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const parsed = parseTravelState(data)
        if (parsed) {
          setTravel(parsed)
        } else {
          notifyFailure('detailsFailed')
        }
      } else {
        notifyFailure('detailsFailed')
      }
    } catch {
      notifyFailure('detailsFailed')
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const isActive = travel?.travel_mode_active ?? false

  const pendingInWindow = React.useMemo(() => {
    if (!isActive || !travel?.travel_start_date || !travel?.travel_end_date) return []
    // All three are date-only values (UTC midnight): compare `YYYY-MM-DD` days.
    const start = toDateOnlyUTC(travel.travel_start_date)
    const end = toDateOnlyUTC(travel.travel_end_date)
    return pendingChores.filter(c => {
      if (!c.due_date) return false
      const due = toDateOnlyUTC(c.due_date)
      return due >= start && due <= end && (c.status === 'pending' || c.status === 'in_progress')
    })
  }, [isActive, travel, pendingChores])

  const formatDate = (d: string | null) => {
    if (!d) return null
    return formatDateOnly(d, { month: 'short', day: 'numeric', year: 'numeric' }, displayLocale)
  }

  if (loading && !travel) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto px-4" aria-busy="true" aria-label={text('refreshing')}>
        <div className="h-24 rounded-2xl bg-[var(--surface-fill)] animate-pulse" />
      </div>
    )
  }

  if (!travel) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto px-4 pb-20">
        <LargeHeader title={text('title')} subtitle={text('subtitle')} className="px-0" />
        <div className="card-apple p-4" role="alert">
          <p className="text-body font-semibold text-label-primary">{text('loadErrorTitle')}</p>
          <p className="text-footnote text-label-secondary mt-1">{text('loadErrorDescription')}</p>
          <button
            type="button"
            onClick={() => void fetchTravel()}
            disabled={loading}
            className="btn-tinted mt-3 min-h-[44px]"
          >
            {loading ? text('refreshing') : text('retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto px-4 pb-20">
      {loadError && (
        <div className="card-apple flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
          <div>
            <p className="text-body font-semibold text-label-primary">{text('loadErrorTitle')}</p>
            <p className="text-footnote text-label-secondary">{text('loadErrorDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchTravel()}
            disabled={loading}
            className="btn-tinted min-h-[44px]"
          >
            {loading ? text('refreshing') : text('retry')}
          </button>
        </div>
      )}
      {isActive && travel?.travel_end_date && (
        <div className="bg-[var(--accent-tint)] rounded-2xl px-4 py-3 flex items-center gap-3">
          <Plane className="w-5 h-5 text-[var(--accent)]" />
          <span className="text-subhead font-semibold text-[var(--accent)]">
            {text('awayBanner', { date: formatDate(travel.travel_end_date) ?? '' })}
          </span>
        </div>
      )}

      <LargeHeader
        title={text('title')}
        subtitle={text('subtitle')}
        className="px-0"
      />

      <div className="card-apple p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-headline text-label-primary">{text('travelMode')}</p>
            <p className="text-footnote text-label-secondary mt-0.5">
              {isActive ? text('on') : text('off')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={saving || loading || loadError}
            className={cn(
              'relative inline-flex h-11 min-h-[44px] w-12 items-center rounded-full transition-colors duration-300',
              isActive ? 'bg-[var(--accent-fill)]' : 'bg-[var(--surface-fill-secondary)]'
            )}
            style={{ transition: 'background 300ms var(--spring-default)' }}
            role="switch"
            aria-checked={isActive}
            aria-label={isActive ? text('turnOff') : text('turnOn')}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-300',
                isActive ? 'translate-x-6' : 'translate-x-1'
              )}
              style={{ transition: 'transform 300ms var(--spring-default)' }}
            />
          </button>
        </div>

        {isActive && (
          <div className="space-y-4 pt-4 border-t border-[var(--surface-separator)]">
            <div>
              <label htmlFor="travel-destination" className="text-subhead text-label-secondary mb-1.5 block">
                <MapPin className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                {text('destination')}
              </label>
              <input
                id="travel-destination"
                type="text"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                placeholder={text('destinationPlaceholder')}
                className="w-full input-apple"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="travel-start-date" className="text-subhead text-label-secondary mb-1.5 block">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                  {text('startDate')}
                </label>
                <input
                  id="travel-start-date"
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full input-apple"
                />
              </div>
              <div>
                <label htmlFor="travel-end-date" className="text-subhead text-label-secondary mb-1.5 block">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                  {text('endDate')}
                </label>
                <input
                  id="travel-end-date"
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full input-apple"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveDetails}
              disabled={saving || loading || loadError}
              className="btn-filled w-full min-h-[44px]"
            >
              {saving ? text('saving') : text('save')}
            </button>
          </div>
        )}
      </div>

      {!isActive && (
        <div className="text-center py-8">
          <Plane className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
          <p className="text-body text-label-secondary">{text('emptyState')}</p>
        </div>
      )}

      {isActive && (
        <div className="space-y-3">
          <p className="section-header">{text('whileAway')}</p>
          {choresLoading ? (
            <div className="card-apple px-4 py-6 text-center" role="status" aria-busy="true">
              <p className="text-body text-label-secondary">{text('choresLoading')}</p>
            </div>
          ) : choresError ? (
            <div className="card-apple px-4 py-6 text-center" role="alert">
              <p className="text-body font-semibold text-label-primary">{text('choresLoadErrorTitle')}</p>
              <p className="text-footnote text-label-secondary mt-1">{text('choresLoadErrorDescription')}</p>
              <button
                type="button"
                onClick={() => void fetchChores()}
                disabled={choresLoading}
                className="btn-tinted mt-3 min-h-[44px]"
              >
                {choresLoading ? text('refreshing') : text('retryChores')}
              </button>
            </div>
          ) : pendingInWindow.length > 0 ? (
            <div className="card-apple divide-y divide-[var(--surface-separator)]">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-body text-label-primary">{text('pendingChores')}</span>
                <span className="text-headline text-[var(--accent)]">{pendingInWindow.length}</span>
              </div>
              {pendingInWindow.slice(0, 5).map(chore => (
                <div key={chore.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-label-primary truncate">{chore.title}</p>
                    <p className="text-footnote text-label-secondary">
                      {chore.assignee?.name ?? text('unassigned')}
                    </p>
                  </div>
                  <span className="text-footnote text-label-tertiary">
                    {formatDateOnly(chore.due_date, undefined, displayLocale)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-apple px-4 py-6 text-center">
              <p className="text-body text-label-secondary">{text('noPendingChores')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
