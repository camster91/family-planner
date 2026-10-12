'use client'

import * as React from 'react'
import { Plus, MapPin, Home, Briefcase, GraduationCap, Trash2 } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { MapPin as MapPinIcon } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'
import { Dialog } from '@/components/ui/dialog'
import { useTranslation } from '@/i18n'
import { useLocationsText } from '@/i18n/locations'

interface Location {
  id: string
  label: string
  address?: string | null
  is_primary?: boolean
  user_id: string
  user_name?: string
  user_avatar?: string | null
}

function isLocation(value: unknown): value is Location {
  if (!value || typeof value !== 'object') return false
  const location = value as Record<string, unknown>
  return (
    typeof location.id === 'string' &&
    typeof location.label === 'string' &&
    typeof location.user_id === 'string' &&
    (location.address === undefined || location.address === null || typeof location.address === 'string') &&
    (location.is_primary === undefined || typeof location.is_primary === 'boolean') &&
    (location.user_name === undefined || typeof location.user_name === 'string') &&
    (location.user_avatar === undefined || location.user_avatar === null || typeof location.user_avatar === 'string')
  )
}

function parseLocationsResponse(value: unknown): Location[] | null {
  if (!value || typeof value !== 'object') return null
  const locations = (value as { locations?: unknown }).locations
  return Array.isArray(locations) && locations.every(isLocation) ? locations : null
}

const ICON_FOR_LABEL: Record<string, any> = {
  Home: Home,
  Work: Briefcase,
  School: GraduationCap,
}

export default function LocationsPage() {
  return (
    <FeatureGate featureKey="locations">
      <LocationsPageInner />
    </FeatureGate>
  )
}

function LocationsPageInner() {
  const [locations, setLocations] = React.useState<Location[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [newLabel, setNewLabel] = React.useState('Home')
  const [newAddress, setNewAddress] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<Location | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const [removeError, setRemoveError] = React.useState<'failed' | 'network' | null>(null)
  const addButtonRef = React.useRef<HTMLButtonElement>(null)
  const addLabelRef = React.useRef<HTMLInputElement>(null)
  const cancelRemoveRef = React.useRef<HTMLButtonElement>(null)
  const removingRef = React.useRef(false)
  const { t } = useTranslation()
  const locationText = useLocationsText()

  // KidHome pattern: a refused or failed request says so in a toast instead
  // of doing nothing (or leaving an unhandled rejection when offline).
  const { addToast } = useToast()
  const failed = React.useCallback(
    async (title: string, res?: Response) => {
      addToast({ type: 'error', title, message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE })
    },
    [addToast]
  )

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/locations', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        const nextLocations = parseLocationsResponse(data)
        if (!nextLocations) {
          setLoadError(true)
          return
        }
        setLocations(nextLocations)
        setLoadError(false)
      } else {
        setLoadError(true)
        await failed("Couldn't load locations", res)
      }
    } catch {
      setLoadError(true)
      await failed("Couldn't load locations")
    } finally {
      setLoading(false)
    }
  }, [failed])

  React.useEffect(() => {
    load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!newLabel.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), address: newAddress.trim() || null }),
      })
      if (res.ok) {
        setNewLabel('Home')
        setNewAddress('')
        setAdding(false)
        load()
      } else {
        await failed("Couldn't add the location", res)
      }
    } catch {
      await failed("Couldn't add the location")
    } finally {
      setSaving(false)
    }
  }

  const openRemoveConfirmation = (location: Location) => {
    if (removingRef.current) return
    setRemoveError(null)
    setRemoveTarget(location)
  }

  const closeRemoveConfirmation = () => {
    if (removingRef.current) return
    setRemoveError(null)
    setRemoveTarget(null)
  }

  const remove = React.useCallback(async () => {
    const location = removeTarget
    if (!location || removingRef.current) return
    removingRef.current = true
    setRemoving(true)
    setRemoveError(null)
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(location.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setRemoveError('failed')
        return
      }
      setRemoveTarget(null)
      window.requestAnimationFrame(() => (addButtonRef.current ?? addLabelRef.current)?.focus())
      void load()
    } catch {
      setRemoveError('network')
    } finally {
      removingRef.current = false
      setRemoving(false)
    }
  }, [load, removeTarget])

  const primary = locations.filter((l) => l.is_primary)
  const others = locations.filter((l) => !l.is_primary)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting="Family"
        title="Locations"
        subtitle="Save the places your family goes — home, school, work."
        trailing={
          !adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-tinted min-h-[44px]"
              ref={addButtonRef}
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          ) : null
        }
      />

      {adding && (
        <form onSubmit={add} className="card-apple p-4 space-y-3 animate-spring-up">
          <div className="flex items-center gap-2">
            <div className="glyph bg-tint-calendar">
              <MapPinIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-headline">New location</span>
          </div>
          <div>
            <label htmlFor="location-label" className="label-apple">Label</label>
            <input
              id="location-label"
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Home, School, Work…"
              className="input-apple"
              ref={addLabelRef}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="location-address" className="label-apple">Address</label>
            <input
              id="location-address"
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="123 Main St"
              className="input-apple"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAdding(false); setNewLabel('Home'); setNewAddress('') }}
              className="btn-plain"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-filled">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {loadError && !loading && (
        <div data-testid="locations-load-error" role="alert" className="card-apple flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-body font-semibold text-label-primary">{locationText('loadErrorTitle')}</p>
            <p className="text-footnote text-label-secondary">{locationText('loadErrorDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn-tinted min-h-[44px] min-w-[44px]"
          >
            {loading ? locationText('refreshing') : locationText('retry')}
          </button>
        </div>
      )}

      {loading && locations.length === 0 ? (
        <div className="list-inset">
          {[1, 2, 3].map((i) => (
            <div key={i} className="row-apple border-b border-[var(--surface-separator)] last:border-b-0">
              <div className="glyph bg-surface-fill shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded-full shimmer" />
                <div className="h-2.5 w-48 rounded-full shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : !loadError && locations.length === 0 ? (
        <EmptyState
          icon={MapPin}
          glyphColor="calendar"
          title="No locations yet"
          description="Add Home, School, Work, or any place the family goes regularly."
        />
      ) : (
        <>
          {primary.length > 0 && (
            <section>
              <SectionHeader>Home</SectionHeader>
              <InsetList>
                {primary.map((l, i) => (
                  <LocationRow key={l.id} location={l} onRemove={openRemoveConfirmation} last={i === primary.length - 1} />
                ))}
              </InsetList>
            </section>
          )}
          {others.length > 0 && (
            <section>
              <SectionHeader>Other places</SectionHeader>
              <InsetList>
                {others.map((l, i) => (
                  <LocationRow key={l.id} location={l} onRemove={openRemoveConfirmation} last={i === others.length - 1} />
                ))}
              </InsetList>
            </section>
          )}
        </>
      )}

      {removeTarget && (
        <Dialog
          open
          role="alertdialog"
          testId="remove-location-dialog"
          title={locationText('removeTitle', { label: removeTarget.label })}
          description={locationText('removeDescription', { label: removeTarget.label })}
          initialFocusRef={cancelRemoveRef}
          onClose={removing ? undefined : closeRemoveConfirmation}
          closeLabel={locationText('removeClose')}
        >
          <div aria-busy={removing}>
            {removeError && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {removeError === 'network'
                  ? locationText('removeNetworkError')
                  : locationText('removeFailed')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelRemoveRef}
                type="button"
                disabled={removing}
                onClick={closeRemoveConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={remove}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {removing
                  ? locationText('removing')
                  : removeError
                    ? t('routeState.tryAgain')
                    : t('common.delete')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function LocationRow({ location, onRemove, last }: { location: Location; onRemove: (location: Location) => void; last: boolean }) {
  const Icon = ICON_FOR_LABEL[location.label] || MapPin
  const locationText = useLocationsText()
  return (
    <div className={`row-apple ${last ? '' : 'border-b border-[var(--surface-separator)]'}`}>
      <div className="glyph bg-tint-calendar">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body text-label-primary">{location.label}</div>
        {location.address && (
          <div className="text-footnote text-label-secondary truncate">{location.address}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(location)}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-label-tertiary active:text-[var(--danger-text)] transition-colors"
        aria-label={locationText('removeButton', { label: location.label })}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
