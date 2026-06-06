'use client'

import * as React from 'react'
import { Plane, MapPin, Calendar } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { LargeHeader } from '@/components/ui/large-header'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

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

export default function TravelPage() {
  return (
    <FeatureGate featureKey="travel">
      <TravelPageInner />
    </FeatureGate>
  )
}

function TravelPageInner() {
  const { t } = useTranslation()
  const [travel, setTravel] = React.useState<TravelState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [destination, setDestination] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [pendingChores, setPendingChores] = React.useState<Chore[]>([])

  const fetchTravel = React.useCallback(async () => {
    try {
      const res = await fetch('/api/family/travel')
      if (res.ok) {
        const data = await res.json()
        setTravel(data)
        setDestination(data.travel_destination ?? '')
        setStartDate(data.travel_start_date ? data.travel_start_date.split('T')[0] : '')
        setEndDate(data.travel_end_date ? data.travel_end_date.split('T')[0] : '')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchChores = React.useCallback(async () => {
    try {
      const res = await fetch('/api/chores')
      if (res.ok) {
        const data = await res.json()
        setPendingChores(data.chores ?? [])
      }
    } catch {}
  }, [])

  React.useEffect(() => {
    fetchTravel()
    fetchChores()
  }, [fetchTravel, fetchChores])

  const handleToggle = async () => {
    if (!travel) return
    setSaving(true)
    try {
      const res = await fetch('/api/family/travel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          travel_mode_active: !travel.travel_mode_active,
          travel_start_date: travel.travel_mode_active ? null : (startDate || new Date().toISOString()),
          travel_end_date: travel.travel_mode_active ? null : endDate,
          travel_destination: travel.travel_mode_active ? null : destination,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setTravel(data)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSaveDetails = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/family/travel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          travel_start_date: startDate,
          travel_end_date: endDate,
          travel_destination: destination,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setTravel(data)
      }
    } finally {
      setSaving(false)
    }
  }

  const isActive = travel?.travel_mode_active ?? false

  const pendingInWindow = React.useMemo(() => {
    if (!isActive || !travel?.travel_start_date || !travel?.travel_end_date) return []
    const start = new Date(travel.travel_start_date)
    const end = new Date(travel.travel_end_date)
    return pendingChores.filter(c => {
      const due = new Date(c.due_date)
      return due >= start && due <= end && (c.status === 'pending' || c.status === 'in_progress')
    })
  }, [isActive, travel, pendingChores])

  const formatDate = (d: string | null) => {
    if (!d) return null
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto px-4">
        <div className="h-24 rounded-2xl bg-[var(--surface-fill)] animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto px-4 pb-20">
      {isActive && travel?.travel_end_date && (
        <div className="bg-[var(--accent-tint)] rounded-2xl px-4 py-3 flex items-center gap-3">
          <Plane className="w-5 h-5 text-[var(--accent)]" />
          <span className="text-subhead font-semibold text-[var(--accent)]">
            {t('travel.awayBanner', { date: formatDate(travel.travel_end_date) ?? '' })}
          </span>
        </div>
      )}

      <LargeHeader
        title={t('travel.title')}
        subtitle={t('travel.subtitle')}
        className="px-0"
      />

      <div className="card-apple p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-headline text-label-primary">{t('travel.travelMode')}</p>
            <p className="text-footnote text-label-secondary mt-0.5">
              {isActive ? 'ON' : 'OFF'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={saving}
            className={cn(
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300',
              isActive ? 'bg-[var(--accent)]' : 'bg-[var(--surface-fill-secondary)]'
            )}
            style={{ transition: 'background 300ms var(--spring-default)' }}
            aria-label={isActive ? 'Turn off travel mode' : 'Turn on travel mode'}
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
              <label className="text-subhead text-label-secondary mb-1.5 block">
                <MapPin className="w-3.5 h-3.5 inline mr-1" />
                {t('travel.destination')}
              </label>
              <input
                type="text"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                placeholder="e.g. Costa Rica"
                className="w-full input-apple"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-subhead text-label-secondary mb-1.5 block">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />
                  {t('travel.startDate')}
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full input-apple"
                />
              </div>
              <div>
                <label className="text-subhead text-label-secondary mb-1.5 block">
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />
                  {t('travel.endDate')}
                </label>
                <input
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
              disabled={saving}
              className="btn-filled w-full"
            >
              {saving ? t('common.saving') : t('travel.save')}
            </button>
          </div>
        )}
      </div>

      {!isActive && (
        <div className="text-center py-8">
          <Plane className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
          <p className="text-body text-label-secondary">{t('travel.emptyState')}</p>
        </div>
      )}

      {isActive && (
        <div className="space-y-3">
          <p className="section-header">{t('travel.whileAway')}</p>
          {pendingInWindow.length > 0 ? (
            <div className="card-apple divide-y divide-[var(--surface-separator)]">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-body text-label-primary">{t('travel.pendingChores')}</span>
                <span className="text-headline text-[var(--accent)]">{pendingInWindow.length}</span>
              </div>
              {pendingInWindow.slice(0, 5).map(chore => (
                <div key={chore.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-label-primary truncate">{chore.title}</p>
                    <p className="text-footnote text-label-secondary">
                      {chore.assignee?.name ?? 'Unassigned'}
                    </p>
                  </div>
                  <span className="text-footnote text-label-tertiary">
                    {new Date(chore.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-apple px-4 py-6 text-center">
              <p className="text-body text-label-secondary">{t('travel.noPendingChores')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}